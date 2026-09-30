import { Inject, Injectable } from '@nestjs/common';
import type { SupplierProvider } from '@barat/suppliers';
import { SUPPLIER_PROVIDERS } from '@barat/suppliers';
import Decimal from 'decimal.js';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { WORK_ITEM_ESCALATOR, type WorkItemEscalator } from '../workitems/workitems.types';
import { TOP_UP_STORE } from './suppliers.types';
import type { SupplierFundingState, TopUpStore, TopUpTarget } from './suppliers.types';

/**
 * The part of a target an escalation needs: enough to say which order, which
 * customer and which fulfillment row it is about.
 *
 * Narrowed to three fields on purpose. Callers here describe a status that may
 * be *about to be written* rather than one already stored — `{ ...target,
 * status: 'UNKNOWN' }` — and widening this to the full `TopUpTarget` would make
 * that spread a type error, pushing the caller into a shape it can only guess
 * at. An escalation never needs a credential, a cost or a supplier key.
 */
type TopUpIdentity = Pick<TopUpTarget, 'orderId' | 'customerId' | 'fulfillmentId'>;

/**
 * ============================================================================
 * Direct top-up: automated delivery with ZERO operator tasks on the happy path
 * ============================================================================
 *
 * The product owner's rule, and the whole reason this service exists separately
 * from `AutoFulfillmentService`:
 *
 *   For a direct top-up NO WorkItem is created for an operator. The system does
 *   every step. A complete trace is kept for each order so that, if something
 *   goes wrong, an operator can investigate, follow up and resolve it.
 *
 * `AutoFulfillmentService` cannot be reused for this. It creates a work item
 * FIRST and unconditionally, before any supplier call, and treats that item as
 * its fallback; its whole safety story is "the task already exists". For a
 * gift card that is right — someone has to hand over a code. For a top-up it is
 * exactly what is forbidden: an operator would be handed a task for an order
 * that needs no human at all, and the queue would fill with work that is really
 * a status row.
 *
 * So this service inverts the design:
 *
 *   - The RECORD is `TopUpFulfillment` + `TopUpEvent`, not `WorkItem`. It is
 *     written first and unconditionally, and it is what an operator reads.
 *   - A WorkItem is created ONLY on a genuine error or ambiguity path — see
 *     `escalate` below. That is the one path by which the customer is answered
 *     through a task, which is what the product owner asked for.
 *
 * Every status change and every supplier interaction appends a `TopUpEvent`,
 * so the trace is complete even though nobody was assigned anything.
 */

/** The audit actor for everything this service does. */
export const TOP_UP_ACTOR = 'system:topup-fulfillment';

export const TOP_UP_AUDIT_ACTION = 'TOP_UP_FULFILLMENT_ATTEMPTED';

/** The provider key the Telegram adapter registers itself under. */
export const TELEGRAM_PROVIDER_KEY = 'fazercards-telegram';

/** What an attempt decided. A non-secret label for the audit row and the log. */
export type TopUpDecision =
  /** Credited. The order is FULFILLED and the customer is told. */
  | 'SUCCEEDED'
  /** Supplier is still working; polled again automatically. No human needed. */
  | 'AWAITING_PROVIDER'
  /** Supplier has no float. Retried automatically; no human needed yet. */
  | 'WAITING_FUNDS'
  /** Supplier said nothing was charged. Order goes to refund. A human refunds. */
  | 'FAILED'
  /** The supplier may have charged. Never re-bought. A human must reconcile. */
  | 'UNKNOWN'
  /** Never a candidate: not paid, already terminal, someone owns it, and so on. */
  | 'NOT_ELIGIBLE';

export interface TopUpOutcome {
  readonly decision: TopUpDecision;
  readonly orderId: string;
  readonly fulfillmentId: string;
  /** A non-secret code naming the exact branch. Never a supplier payload. */
  readonly reason: string;
  /**
   * The task opened for this order, when the branch needed a human. Null on
   * every automated branch — which is all of them on the happy path.
   */
  readonly workItemId: string | null;
}

/**
 * How long a top-up waits on an empty float before it stops retrying itself.
 *
 * Past this the order stops being "the float is momentarily empty" and becomes
 * "this has not worked for a day", which a person needs to look at. Without a
 * bound, an unfunded supplier account would silently hold customer orders
 * forever and the failure would never surface anywhere.
 */
const MAX_WAITING_FUNDS_ATTEMPTS = 144;

/** Retry cadence for an empty float: every ten minutes. */
const WAITING_FUNDS_RETRY_MS = 10 * 60 * 1_000;

/**
 * How many consecutive unreachable status polls before a person is asked.
 *
 * Five, not one: a supplier blip is not news, and escalating on the first
 * timeout would open a task every time the venue hiccups. But an unbounded
 * retry is worse than either — a supplier that has been unreachable for hours
 * is a customer whose top-up nobody is looking at, and without a bound the
 * fulfillment would sit in `AWAITING_PROVIDER` forever with nothing surfacing.
 */
const MAX_UNREACHABLE_POLLS = 5;

function isTransientPollOutcome(
  outcome: Awaited<ReturnType<SupplierProvider['getPurchaseStatus']>>,
): boolean {
  /* Adapters normalise a failed status request without throwing when they can
   * distinguish transport failure from an ambiguous purchase result. Only this
   * narrow family receives bounded status retries; every other UNKNOWN remains
   * a genuine ambiguity and is escalated without a re-purchase. */
  return (
    outcome.status === 'UNKNOWN' &&
    ['NETWORK_ERROR', 'NETWORK_UNREACHABLE', 'PROVIDER_UNREACHABLE', 'TIMEOUT'].includes(
      outcome.failureCode ?? '',
    )
  );
}

@Injectable()
export class TopUpFulfillmentService {
  constructor(
    @Inject(TOP_UP_STORE) private readonly store: TopUpStore,
    @Inject(SUPPLIER_PROVIDERS) providers: readonly SupplierProvider[],
    @Inject(WORK_ITEM_ESCALATOR) private readonly escalator: WorkItemEscalator,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.providersByKey = new Map(providers.map((provider) => [provider.key, provider]));
  }

  private readonly providersByKey: ReadonlyMap<string, SupplierProvider>;

  /**
   * The entry point the `FULFILLMENT_TRIGGER` calls for a top-up order.
   *
   * Deliberately does NOT throw for an ordinary bad outcome. A supplier that is
   * out of float, or slow, or unreachable is a normal state of the world, and a
   * payment callback must not fail because of one. Only a request that cannot
   * be routed at all — an unknown order — is an error.
   */
  async onTopUpOrderPaid(orderId: string): Promise<TopUpOutcome> {
    const target = await this.store.ensureFulfillmentForPaidOrder(orderId);
    if (target === null) {
      /*
       * No fulfillment row means the order was not created by the top-up path,
       * or its quote is missing the offer. Both are programming errors rather
       * than supply problems, so this is the one branch that throws — and it
       * throws before any money is spent.
       */
      throw DomainErrors.notFound(`top-up fulfillment for order ${orderId}`);
    }

    const outcome = await this.attempt(target);
    await this.record(outcome);
    return outcome;
  }

  /**
   * Poll a top-up the supplier has accepted but not yet completed.
   *
   * Separate from `onTopUpOrderPaid` because it is driven by the worker's
   * schedule rather than by a payment callback, and because it must never
   * re-purchase: the supplier already has the order.
   */
  async poll(orderId: string): Promise<TopUpOutcome> {
    const target = await this.store.findTargetByOrderId(orderId);
    if (target === null) {
      throw DomainErrors.notFound(`top-up fulfillment for order ${orderId}`);
    }

    const provider = this.providersByKey.get(target.supplierCode);
    if (provider === undefined || target.providerOrderNumber === null) {
      /*
       * No adapter, or no order number to poll. Neither can be retried into
       * working, so this escalates to a person rather than looping forever.
       */
      return this.markUnknownAndEscalate(target, {
        reason:
          provider === undefined ? 'SUPPLIER_HAS_NO_ADAPTER' : 'NO_PROVIDER_ORDER_NUMBER',
        type: 'UNKNOWN_OUTCOME',
        title: 'نتیجهٔ نامشخص سفارش شارژ',
        description:
          'وضعیت این شارژ از تأمین‌کننده قابل استعلام نیست. بدون خرید مجدد، نتیجه را بررسی کنید.',
      });
    }

    let status: Awaited<ReturnType<SupplierProvider['getPurchaseStatus']>>;
    try {
      status = await provider.getPurchaseStatus(target.providerOrderNumber);
    } catch {
      return this.handleUnreachablePoll(target);
    }

    if (isTransientPollOutcome(status)) {
      return this.handleUnreachablePoll(target);
    }

    return this.applyProviderStatus(target, status);
  }

  private async handleUnreachablePoll(target: TopUpTarget): Promise<TopUpOutcome> {
    /* A transport error or a provider's normalised network result says nothing
     * about whether it charged us. Retry status only; never purchase again. */
    const attempts = await this.store.countConsecutiveUnreachablePolls(target.fulfillmentId);
    const failureEvent = {
      type: 'STATUS_POLLED' as const,
      detail: { reachable: false, consecutiveUnreachablePolls: attempts + 1 },
    };
    if (attempts + 1 >= MAX_UNREACHABLE_POLLS) {
      await this.store.recordEvent({
        fulfillmentId: target.fulfillmentId,
        orderId: target.orderId,
        status: target.status,
        event: failureEvent,
      });
      return this.markUnknownAndEscalate(target, {
        reason: 'STATUS_CHECKS_EXHAUSTED',
        type: 'UNKNOWN_OUTCOME',
        title: 'نتیجهٔ نامشخص شارژ',
        description:
          'تأمین‌کننده پاسخ نمی‌دهد و وضعیت این شارژ قابل استعلام نیست. بدون خرید مجدد، نتیجه را بررسی کنید.',
      });
    }

    const moved = await this.store.transition({
      fulfillmentId: target.fulfillmentId,
      from: ['AWAITING_PROVIDER'],
      to: 'AWAITING_PROVIDER',
      nextCheckAt: new Date(Date.now() + WAITING_FUNDS_RETRY_MS),
      event: failureEvent,
    });
    if (!moved) {
      return {
        decision: 'NOT_ELIGIBLE',
        orderId: target.orderId,
        fulfillmentId: target.fulfillmentId,
        reason: 'POLL_IN_FLIGHT',
        workItemId: null,
      };
    }
    return {
      decision: 'AWAITING_PROVIDER',
      orderId: target.orderId,
      fulfillmentId: target.fulfillmentId,
      reason: 'STATUS_CHECK_UNREACHABLE',
      workItemId: null,
    };
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                               */
  /* ---------------------------------------------------------------------- */

  private async attempt(target: TopUpTarget): Promise<TopUpOutcome> {
    const notEligible = this.checkEligibility(target);
    if (notEligible !== null) {
      return notEligible;
    }

    const provider = this.providersByKey.get(target.supplierCode);
    if (provider === undefined) {
      /*
       * A top-up with no adapter can never complete by itself. This is a
       * configuration fault, not a supply blip, so it escalates — once, on a
       * deterministic code, so a replayed callback does not open a second task.
       */
      return this.markUnknownAndEscalate(target, {
        reason: 'SUPPLIER_HAS_NO_ADAPTER',
        type: 'SUPPLIER_FOLLOWUP',
        title: 'شارژ بدون اتصال تأمین‌کننده',
        description: 'برای این تأمین‌کننده اتصال خودکار ثبت نشده است و شارژ انجام نشد.',
      });
    }

    const funding = await this.checkFunding(target, provider);
    if (funding === 'INSUFFICIENT' || funding === 'UNKNOWN') {
      /*
       * No purchase is attempted at all, so an empty account can never become a
       * half-placed order. `WAITING_FUNDS` is retried automatically — this is
       * the branch that must NOT create a task, or every top-up made while the
       * float is low would land in an operator's queue.
       */
      return this.waitForFunds(target, funding);
    }

    return this.purchase(target, provider);
  }

  /**
   * Every reason an order is not a candidate to be charged, or null.
   *
   * None of these open a work item. They describe states where the automated
   * path has already done its job (the order is fulfilled) or is not the right
   * actor (an operator owns it), and creating a task would be noise.
   */
  private checkEligibility(target: TopUpTarget): TopUpOutcome | null {
    const ineligible = (reason: string): TopUpOutcome => ({
      decision: 'NOT_ELIGIBLE',
      orderId: target.orderId,
      fulfillmentId: target.fulfillmentId,
      reason,
      workItemId: null,
    });

    if (target.status === 'SUCCEEDED') {
      return ineligible('ALREADY_SUCCEEDED');
    }
    if (target.status === 'FAILED' || target.status === 'UNKNOWN') {
      /* Terminal without human input. Never re-bought automatically: for both
       * of these the correct next step is a person's decision, and this method
       * is not where a person is involved. */
      return ineligible(`TERMINAL_${target.status}`);
    }
    if (target.status === 'PURCHASING') {
      /* Another worker holds the claim. Two concurrent purchases of one top-up
       * would be a real loss, so the second one stands down. */
      return ineligible('PURCHASE_IN_FLIGHT');
    }
    if (!['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'].includes(target.orderStatus)) {
      return ineligible('ORDER_NOT_DELIVERABLE');
    }
    return null;
  }

  /**
   * Ask the supplier whether we can still afford this, before buying.
   *
   * Mirrors `SuppliersService.checkFunding`'s three rules — an unreachable
   * venue is never read as funded, a missing adapter is never funded, and a
   * balance we cannot compare is only trusted when strictly positive — because
   * guessing here costs a half-placed order.
   */
  private async checkFunding(
    target: TopUpTarget,
    provider: SupplierProvider,
  ): Promise<SupplierFundingState> {
    const readBalance = provider.getBalance;
    if (readBalance === undefined) {
      /* No published balance: an invoiced supplier. Not applicable is not the
       * same as funded, but it is also not a reason to refuse a purchase that
       * this supplier would have accepted. */
      await this.store.recordEvent({
        fulfillmentId: target.fulfillmentId,
        orderId: target.orderId,
        status: target.status,
        event: { type: 'BALANCE_CHECKED', detail: { state: 'NOT_APPLICABLE' } },
      });
      return 'NOT_APPLICABLE';
    }

    let state: SupplierFundingState;
    let detail: Record<string, unknown>;
    try {
      const balance = await readBalance.call(provider);
      const held = new Decimal(balance.amount);
      const required = new Decimal(target.costAmount);
      const currencyMismatch = balance.currency !== target.costCurrency;
      state = currencyMismatch
        ? held.greaterThan(0)
          ? 'SUFFICIENT'
          : 'INSUFFICIENT'
        : held.greaterThanOrEqualTo(required)
          ? 'SUFFICIENT'
          : 'INSUFFICIENT';
      /* A balance is not a secret, but it is operational detail. It is recorded
       * in the trace rather than shown to anyone. */
      detail = {
        state,
        balanceAmount: balance.amount,
        balanceCurrency: balance.currency,
        requiredAmount: target.costAmount,
        requiredCurrency: target.costCurrency,
        currencyMismatch,
      };
    } catch {
      state = 'UNKNOWN';
      detail = { state };
    }

    await this.store.recordEvent({
      fulfillmentId: target.fulfillmentId,
      orderId: target.orderId,
      status: target.status,
      event: { type: 'BALANCE_CHECKED', detail },
    });
    return state;
  }

  private async waitForFunds(
    target: TopUpTarget,
    funding: SupplierFundingState,
  ): Promise<TopUpOutcome> {
    const attempts = target.purchaseAttempts + 1;
    const exhausted = attempts >= MAX_WAITING_FUNDS_ATTEMPTS;

    if (exhausted) {
      /*
       * The float has been empty for a day. This is no longer a blip, and the
       * customer's money is sitting with us — so this is one of the genuine
       * error paths that DOES open a task. A person can top the supplier up and
       * re-run the fulfillment.
       */
      return this.markUnknownAndEscalate(target, {
        reason: 'FUNDING_EXHAUSTED',
        type: 'SUPPLIER_FOLLOWUP',
        title: 'موجودی تأمین‌کننده برای شارژ کافی نیست',
        description:
          'موجودی حساب تأمین‌کننده پس از تلاش‌های مکرر کافی نشد. پس از شارژ حساب، این سفارش را دوباره اجرا کنید.',
      });
    }

    const nextCheckAt = new Date(Date.now() + WAITING_FUNDS_RETRY_MS);
    await this.store.transition({
      fulfillmentId: target.fulfillmentId,
      from: ['QUEUED', 'WAITING_FUNDS'],
      to: 'WAITING_FUNDS',
      nextCheckAt,
      incrementPurchaseAttempts: true,
      event: { type: 'BALANCE_CHECKED', detail: { funding, attempts, nextCheckAt: nextCheckAt.toISOString() } },
    });

    /* No work item, by design: the retry is the system's job alone. */
    return {
      decision: 'WAITING_FUNDS',
      orderId: target.orderId,
      fulfillmentId: target.fulfillmentId,
      reason: `FUNDING_${funding}`,
      workItemId: null,
    };
  }

  private async purchase(
    target: TopUpTarget,
    provider: SupplierProvider,
  ): Promise<TopUpOutcome> {
    const claimed = await this.store.transition({
      fulfillmentId: target.fulfillmentId,
      from: ['QUEUED', 'WAITING_FUNDS'],
      to: 'PURCHASING',
      incrementPurchaseAttempts: true,
      event: { type: 'PURCHASE_REQUESTED', detail: { attempt: target.purchaseAttempts + 1 } },
    });
    if (!claimed) {
      /* Lost the race to another worker. Standing down is the correct answer,
       * and emphatically not a second purchase. */
      return {
        decision: 'NOT_ELIGIBLE',
        orderId: target.orderId,
        fulfillmentId: target.fulfillmentId,
        reason: 'PURCHASE_IN_FLIGHT',
        workItemId: null,
      };
    }

    let result: Awaited<ReturnType<SupplierProvider['purchase']>>;
    try {
      result = await provider.purchase({
        providerSku: target.providerSku,
        quantity: 1,
        /*
         * Derived from the order, so a retry reaches the supplier as the same
         * purchase rather than as a second one. The Telegram adapter keeps both
         * an in-flight map and a 24-hour result cache keyed on this, because
         * that API has no `Idempotency-Key` header of its own.
         */
        idempotencyKey: `topup:${target.orderId}`,
        /* The customer's game account. Without this the purchase cannot be
         * credited, and the adapter would fail every call. */
        accountFields: target.accountFields,
      });
    } catch {
      /*
       * The connection broke mid-call, so we cannot know whether the supplier
       * charged us. UNKNOWN, never FAILED — asserting a failure here and
       * refunding would hand back money for a top-up that may have been
       * delivered. The thrown value is dropped, not logged: it may carry a raw
       * response body.
       */
      result = { status: 'UNKNOWN', failureCode: 'PROVIDER_CONNECTION_AMBIGUOUS' };
    }

    return this.applyProviderStatus(target, result);
  }

  /**
   * Turn a supplier result into a status, always recording why.
   *
   * `SUCCEEDED`, `AWAITING_PROVIDER` and `WAITING_FUNDS` are automated and open
   * no task. `FAILED` and `UNKNOWN` are the two genuine error paths, and each
   * opens exactly one task — see `escalate`.
   */
  private async applyProviderStatus(
    target: TopUpTarget,
    result: Awaited<ReturnType<SupplierProvider['purchase']>>,
  ): Promise<TopUpOutcome> {
    /*
     * There is no separate provider status on the interface — `status` IS it,
     * already normalised by the adapter. `getPurchaseStatus` for polling returns
     * the same shape, so a poll and a fresh purchase describe themselves the
     * same way and neither can drift from the other. Recorded because "the
     * supplier said PENDING" and "the supplier said FAILED" are different
     * stories for whoever reads the trace.
     */
    const common = {
      providerStatus: result.status,
      failureCode: result.failureCode ?? null,
      providerOrderNumber: result.providerReference ?? target.providerOrderNumber ?? null,
      chargedAmount: result.cost?.amount ?? null,
      chargedCurrency: result.cost?.currency ?? null,
    };

    switch (result.status) {
      case 'SUCCEEDED': {
        const now = new Date();
        const moved = await this.store.transition({
          fulfillmentId: target.fulfillmentId,
          from: ['PURCHASING', 'AWAITING_PROVIDER', 'QUEUED', 'WAITING_FUNDS'],
          to: 'SUCCEEDED',
          completedAt: now,
          nextCheckAt: null,
          ...common,
          event: { type: 'SUCCEEDED', providerStatus: common.providerStatus },
        });
        if (moved) {
          await this.store.transitionOrder({
            orderId: target.orderId,
            from: ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'],
            to: 'FULFILLED',
          });
          /* Order fulfillment is customer-visible through the order endpoint.
           * Do not write CUSTOMER_NOTIFIED: no notification transport ran. */
        }
        return {
          decision: 'SUCCEEDED',
          orderId: target.orderId,
          fulfillmentId: target.fulfillmentId,
          reason: 'PROVIDER_REPORTED_SUCCESS',
          workItemId: null,
        };
      }

      case 'PENDING': {
        /*
         * The supplier accepted the order and is still working. Polled
         * automatically — the customer is told nothing yet, because there is
         * nothing true to tell them, and no operator is involved.
         */
        await this.store.transition({
          fulfillmentId: target.fulfillmentId,
          from: ['PURCHASING', 'AWAITING_PROVIDER', 'QUEUED'],
          to: 'AWAITING_PROVIDER',
          nextCheckAt: new Date(Date.now() + WAITING_FUNDS_RETRY_MS),
          ...common,
          event: { type: 'PURCHASE_RESPONDED', providerStatus: common.providerStatus },
        });
        return {
          decision: 'AWAITING_PROVIDER',
          orderId: target.orderId,
          fulfillmentId: target.fulfillmentId,
          reason: 'PROVIDER_REPORTED_PENDING',
          workItemId: null,
        };
      }

      case 'FAILED': {
        /*
         * The supplier states nothing was charged. That is definitive, so the
         * order goes to refund — and a person has to actually move the money,
         * because the gateway has no refund API. That is why this opens a task:
         * the operator both refunds and answers the customer.
         */
        await this.store.transition({
          fulfillmentId: target.fulfillmentId,
          from: ['PURCHASING', 'AWAITING_PROVIDER', 'QUEUED', 'WAITING_FUNDS'],
          to: 'FAILED',
          completedAt: new Date(),
          nextCheckAt: null,
          ...common,
          event: {
            type: 'FAILED',
            failureCode: common.failureCode ?? 'SUPPLIER_FAILED',
            providerStatus: common.providerStatus,
          },
        });
        await this.store.transitionOrder({
          orderId: target.orderId,
          from: ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'],
          to: 'REFUND_PENDING',
          failureReason: common.failureCode ?? 'SUPPLIER_FAILED',
        });
        return this.escalate(
          target,
          {
            decision: 'FAILED',
            reason: common.failureCode ?? 'SUPPLIER_FAILED',
            type: 'REFUND_REVIEW',
            title: 'بازگشت وجه شارژ ناموفق',
            description:
              'خرید شارژ ناموفق بود و تأمین‌کننده مبلغی کسر نکرد. بازگشت وجه به مشتری را پیگیری کنید.',
          },
        );
      }

      case 'UNKNOWN': {
        /*
         * The supplier may have charged. Never re-bought automatically: a retry
         * could buy a second top-up for one payment. A person must find out
         * what actually happened, which is precisely the "if something goes
         * wrong, an operator receives a task and answers the customer" case the
         * product owner described.
         */
        await this.store.transition({
          fulfillmentId: target.fulfillmentId,
          from: ['PURCHASING', 'AWAITING_PROVIDER', 'QUEUED', 'WAITING_FUNDS'],
          to: 'UNKNOWN',
          completedAt: new Date(),
          nextCheckAt: null,
          ...common,
          event: {
            type: 'MARKED_UNKNOWN',
            failureCode: common.failureCode ?? 'UNKNOWN',
            providerStatus: common.providerStatus,
          },
        });
        await this.store.transitionOrder({
          orderId: target.orderId,
          from: ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'],
          to: 'REVIEW_REQUIRED',
          failureReason: common.failureCode ?? 'UNKNOWN',
        });
        return this.escalate(
          target,
          {
            decision: 'UNKNOWN',
            reason: common.failureCode ?? 'UNKNOWN',
            type: 'UNKNOWN_OUTCOME',
            title: 'نتیجهٔ نامشخص شارژ',
            description:
              'وضعیت پرداخت تأمین‌کننده نامشخص است؛ خرید مجدد ممنوع است. نتیجه را از تأمین‌کننده استعلام و به مشتری اعلام کنید.',
          },
        );
      }

      default: {
        const exhaustive: never = result.status;
        throw DomainErrors.conflict(
          'نتیجهٔ تأمین‌کننده قابل شناسایی نیست.',
          `unknown top-up status ${String(exhaustive)}`,
        );
      }
    }
  }

  private async markUnknownAndEscalate(
    target: TopUpTarget,
    input: {
      readonly reason: string;
      readonly type: 'UNKNOWN_OUTCOME' | 'SUPPLIER_FOLLOWUP';
      readonly title: string;
      readonly description: string;
    },
  ): Promise<TopUpOutcome> {
    const moved = await this.store.transition({
      fulfillmentId: target.fulfillmentId,
      from: ['QUEUED', 'WAITING_FUNDS', 'PURCHASING', 'AWAITING_PROVIDER'],
      to: 'UNKNOWN',
      completedAt: new Date(),
      nextCheckAt: null,
      failureCode: input.reason,
      event: { type: 'MARKED_UNKNOWN', failureCode: input.reason },
    });
    if (moved) {
      await this.store.transitionOrder({
        orderId: target.orderId,
        from: ['PAID', 'FULFILLMENT_PENDING', 'FULFILLING'],
        to: 'REVIEW_REQUIRED',
        failureReason: input.reason,
      });
    }
    return this.escalate(target, { decision: 'UNKNOWN', ...input });
  }

  /**
   * THE ONLY PLACE A TOP-UP WORK ITEM IS EVER CREATED.
   *
   * Everything else in this service returns `workItemId: null`. This is called
   * from exactly three branches — a missing adapter, exhausted funding, a FAILED
   * or UNKNOWN purchase — and each one means the automated path has genuinely
   * stopped and a person has to act: refund money, top up the supplier account,
   * or find out whether the supplier charged us.
   *
   * Two properties matter and both come from `openEscalation`:
   *
   *   - The code is deterministic (`topup:<reason>:<orderId>`), so replaying a
   *     payment callback five times opens exactly one task. Idempotency here is
   *     what stops the operator queue from filling with duplicates of the same
   *     problem.
   *   - It does NOT take the order lock. A top-up order has no fulfillment
   *     WorkItem holding `activeOrderKey`, so without this the task would be
   *     the only item on the order — which is fine — but it must still never
   *     pretend to be the order's fulfillment. `holdsOrderLock: false` keeps
   *     that distinction, and lets a later escalation coexist if needed.
   *
   * The title/description deliberately do not name a generic gift-card
   * fulfillment: these tasks are about a failed or unclear CHARGE, which is a
   * different job from hand-delivering a code.
   */
  private async escalate(
    target: TopUpIdentity,
    input: {
      readonly decision: TopUpDecision;
      readonly reason: string;
      readonly type: 'REFUND_REVIEW' | 'UNKNOWN_OUTCOME' | 'SUPPLIER_FOLLOWUP';
      readonly title: string;
      readonly description: string;
    },
  ): Promise<TopUpOutcome> {
    const workItem = await this.escalator.openEscalation({
      code: `topup:${input.type}:${target.orderId}`,
      orderId: target.orderId,
      customerId: target.customerId,
      type: input.type,
      title: input.title,
      description: input.description,
      /* Operational context for the human. No credential and no account field
       * value: the trace has those for whoever is authorised to look. */
      payload: {
        reason: input.reason,
        fulfillmentId: target.fulfillmentId,
        source: 'TOP_UP_FULFILLMENT',
      },
    });

    return {
      decision: input.decision,
      orderId: target.orderId,
      fulfillmentId: target.fulfillmentId,
      reason: input.reason,
      workItemId: workItem.id,
    };
  }

  /** One audit row per attempt, whatever it decided. Never a payload or a key. */
  private async record(outcome: TopUpOutcome): Promise<void> {
    await this.audit.record({
      actor: TOP_UP_ACTOR,
      actorType: 'SYSTEM',
      action: TOP_UP_AUDIT_ACTION,
      entity: 'TopUpFulfillment',
      entityId: outcome.fulfillmentId,
      after: {
        orderId: outcome.orderId,
        decision: outcome.decision,
        reason: outcome.reason,
        workItemId: outcome.workItemId,
        attemptedAt: new Date().toISOString(),
      },
    });
  }
}
