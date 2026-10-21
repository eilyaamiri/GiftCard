import { Inject, Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { SupplierBalance, SupplierProvider, SupplierPurchaseResult } from '@barat/suppliers';
import { SUPPLIER_PROVIDERS } from '@barat/suppliers';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { DELIVERABLE_ORDER_STATUSES } from '../fulfillment/checklist-evaluation';
import { MANAGER_APPROVAL_ROLE_SET } from '../fulfillment/fulfillment.types';
import type { StaffContext } from '../workitems/staff-context';
import { WORK_ITEM_ESCALATOR, type WorkItemEscalator } from '../workitems/workitems.types';
import { FulfillmentService } from '../fulfillment/fulfillment.service';
import { SUPPLIER_STORE } from './suppliers.types';
import type {
  AutoFulfillmentTarget,
  SupplierFundingState,
  SupplierFundingView,
  SupplierOfferView,
  SupplierPurchaseOutcome,
  SupplierPurchaseStatusView,
  SupplierStore,
  SupplierView,
} from './suppliers.types';

/**
 * Narrows a provider result to the fields that are safe to hand to an operator.
 *
 * Written as an explicit field-by-field construction rather than a spread-and-
 * delete: a spread would silently re-admit any new secret-bearing field a future
 * provider adapter adds to `SupplierPurchaseResult`.
 */
function toPurchaseStatusView(
  result: SupplierPurchaseResult,
  fallbackReference: string,
): SupplierPurchaseStatusView {
  return {
    status: result.status,
    providerReference: result.providerReference ?? fallbackReference,
    cost: result.cost === undefined ? null : { amount: result.cost.amount, currency: result.cost.currency },
    assetType: result.asset?.assetType ?? null,
    failureCode: result.failureCode ?? null,
  };
}

export const SUPPLIER_AUDIT_ACTIONS = {
  AVAILABILITY_CHECKED: 'SUPPLIER_AVAILABILITY_CHECKED',
  BALANCE_CHECKED: 'SUPPLIER_BALANCE_CHECKED',
  PURCHASE_SUCCEEDED: 'SUPPLIER_PURCHASE_SUCCEEDED',
  PURCHASE_PENDING: 'SUPPLIER_PURCHASE_PENDING',
  PURCHASE_FAILED: 'SUPPLIER_PURCHASE_FAILED',
  PURCHASE_UNKNOWN: 'SUPPLIER_PURCHASE_UNKNOWN',
  STAFF_PURCHASE_REQUESTED: 'SUPPLIER_PURCHASE_REQUESTED_BY_STAFF',
  PURCHASE_ATTEMPT_CLOSED: 'SUPPLIER_PURCHASE_ATTEMPT_CLOSED_BY_STAFF',
} as const;

const UNKNOWN_OUTCOME_PREFIX = 'UNKNOWN_OUTCOME';
const PENDING_FOLLOWUP_PREFIX = 'SUPPLIER_PENDING';

/**
 * The supplier idempotency key for an order's purchase generation (FUL-2).
 *
 * Generation 1 keeps the key the automated path has always sent, so a purchase
 * placed before this change and replayed after it still reaches the supplier
 * as the same request. A later generation exists only after the previous one
 * definitively failed and someone asked for a retry.
 */
export function purchaseIdempotencyKey(orderId: string, generation: number): string {
  return generation === 1 ? `auto-fulfillment:${orderId}` : `auto-fulfillment:${orderId}:${generation}`;
}

function providerMap(providers: readonly SupplierProvider[]): ReadonlyMap<string, SupplierProvider> {
  return new Map(providers.map((provider) => [provider.key, provider]));
}

/** What one supplier purchase is for. */
export interface SupplierPurchaseInput {
  readonly orderId: string;
  readonly customerId?: string | null;
  readonly workItemId: string;
  readonly offerId: string;
  readonly quantity: number;
  /**
   * Start the next generation after a purchase that definitively FAILED. The
   * idempotency key itself is never the caller's: it is derived from the order
   * and the generation (FUL-2), so a fresh key can no longer slip past the
   * supplier's duplicate protection.
   */
  readonly retry?: boolean;
  /** The staff member who asked for this purchase; absent for the automated path. */
  readonly requestedByStaffId?: string | null;
  readonly recipientEmail?: string;
  /**
   * The game account to credit, for a direct top-up. A public identifier such
   * as `player_id` or `telegram_username` — never a credential, because games
   * that require a login are refused at quote time.
   *
   * Only the top-up path supplies this. It is forwarded verbatim: the adapter
   * is the only layer that knows what the supplier calls these fields.
   */
  readonly accountFields?: Readonly<Record<string, string>>;
}

/**
 * Provider-neutral supplier orchestration.
 *
 * The domain calls only `SupplierProvider`; it never imports an SDK, a provider
 * payload type or a provider-specific method. Supplier selection is persisted as
 * `SupplierOffer`, so adding Reloadly/Runa/Tillo is data plus an adapter, not a
 * rewrite of order or fulfillment code.
 */
@Injectable()
export class SuppliersService {
  private readonly providersByKey: ReadonlyMap<string, SupplierProvider>;
  /** Tail of the in-flight purchase chain per order id. See `purchase`. */
  private readonly purchaseLocks = new Map<string, Promise<void>>();

  constructor(
    @Inject(SUPPLIER_STORE) private readonly store: SupplierStore,
    @Inject(SUPPLIER_PROVIDERS) providers: readonly SupplierProvider[],
    @Inject(WORK_ITEM_ESCALATOR) private readonly escalator: WorkItemEscalator,
    @Inject(FulfillmentService) private readonly fulfillment: FulfillmentService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.providersByKey = providerMap(providers);
  }

  async listSuppliers(): Promise<readonly SupplierView[]> {
    const rows = await this.store.listSuppliers();
    return rows.map((row) => ({ ...row, hasProvider: this.providersByKey.has(row.code) }));
  }

  async listOffers(skuId: string): Promise<readonly SupplierOfferView[]> {
    return this.store.findOffersForSku(skuId);
  }

  /** The purchase a work item stands for, re-read from the database. */
  async findAutoFulfillmentTarget(workItemId: string): Promise<AutoFulfillmentTarget | null> {
    return this.store.findAutoFulfillmentTarget(workItemId);
  }

  /** True when an adapter is registered for this supplier code. */
  hasProvider(supplierCode: string): boolean {
    return this.providersByKey.has(supplierCode);
  }

  /**
   * Selects the cheapest active offer, with `priority` as deterministic tie-breaker.
   * Availability is checked through the adapter before returning it.
   */
  async selectOffer(skuId: string): Promise<SupplierOfferView> {
    const offers = await this.store.findOffersForSku(skuId);
    if (offers.length === 0) {
      throw DomainErrors.notFound(`active supplier offer for SKU ${skuId}`);
    }

    for (const offer of offers) {
      const provider = this.providersByKey.get(offer.supplierCode);
      if (provider === undefined) {
        // Manual suppliers remain selectable: their offer is fulfilled by an
        // operator, not by an absent API adapter.
        if (offer.availability === 'AVAILABLE') {
          return offer;
        }
        continue;
      }

      const availability = await provider.checkAvailability(offer.providerSku);
      await this.store.recordAvailabilityCheck({
        offerId: offer.id,
        availability: availability.availability,
        checkedAt: availability.observedAt,
      });
      await this.audit.record({
        actor: 'system:supplier-selection',
        actorType: 'SYSTEM',
        action: SUPPLIER_AUDIT_ACTIONS.AVAILABILITY_CHECKED,
        entity: 'SupplierOffer',
        entityId: offer.id,
        after: {
          supplierId: offer.supplierId,
          supplierCode: offer.supplierCode,
          skuId,
          availability: availability.availability,
          checkedAt: availability.observedAt.toISOString(),
        },
      });

      if (availability.availability === 'AVAILABLE') {
        return offer;
      }
    }

    throw DomainErrors.conflict(
      'در حال حاضر تأمین‌کننده‌ای برای این محصول موجود نیست.',
      `no active available supplier offer for SKU ${skuId}`,
    );
  }

  /**
   * Asks the supplier whether we can still afford this offer, before buying.
   *
   * Three rules, all in the same direction — only a positive, comparable answer
   * unlocks a purchase:
   *
   *   - A supplier with no adapter, or an adapter that publishes no balance, is
   *     `NOT_APPLICABLE`. It is never read as "funded".
   *   - An unreachable venue is `UNKNOWN`, never `SUFFICIENT`. We do not know,
   *     and guessing costs a half-placed order.
   *   - A balance in a currency we cannot compare against the cost only passes
   *     when it is strictly positive, and says so via `currencyMismatch`. This
   *     module holds no FX rate for a supplier pair, and inventing one to
   *     compare money would be exactly the float arithmetic rule 2 forbids.
   */
  async checkFunding(input: {
    offerId: string;
    quantity: number;
  }): Promise<SupplierFundingView> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1) {
      throw DomainErrors.validation([
        { path: 'quantity', message: 'quantity must be a positive integer' },
      ]);
    }

    const offer = await this.store.findOfferById(input.offerId);
    if (offer === null || !offer.isActive) {
      throw DomainErrors.notFound(`supplier offer ${input.offerId}`);
    }

    const required = {
      amount: new Decimal(offer.costAmount).times(input.quantity).toFixed(),
      currency: offer.costCurrency,
    };
    const base = { supplierCode: offer.supplierCode, required, currencyMismatch: false };

    const provider = this.providersByKey.get(offer.supplierCode);
    const readBalance = provider?.getBalance;
    if (provider === undefined || readBalance === undefined) {
      return { ...base, state: 'NOT_APPLICABLE', balance: null };
    }

    let balance: SupplierBalance;
    try {
      balance = await readBalance.call(provider);
    } catch {
      // The provider error may carry a credential or a raw body; it is dropped
      // rather than logged, and the state alone tells the caller to stand down.
      await this.recordFundingCheck({ ...base, state: 'UNKNOWN', balance: null });
      return { ...base, state: 'UNKNOWN', balance: null };
    }

    const observed = { amount: balance.amount, currency: balance.currency };
    const currencyMismatch = balance.currency !== offer.costCurrency;
    const held = new Decimal(balance.amount);
    const state: SupplierFundingState = currencyMismatch
      ? held.greaterThan(0)
        ? 'SUFFICIENT'
        : 'INSUFFICIENT'
      : held.greaterThanOrEqualTo(new Decimal(required.amount))
        ? 'SUFFICIENT'
        : 'INSUFFICIENT';

    const view: SupplierFundingView = { ...base, state, balance: observed, currencyMismatch };
    await this.recordFundingCheck(view);
    return view;
  }

  private async recordFundingCheck(view: SupplierFundingView): Promise<void> {
    await this.audit.record({
      actor: 'system:supplier-funding',
      actorType: 'SYSTEM',
      action: SUPPLIER_AUDIT_ACTIONS.BALANCE_CHECKED,
      entity: 'Supplier',
      entityId: view.supplierCode,
      after: {
        supplierCode: view.supplierCode,
        state: view.state,
        balanceAmount: view.balance?.amount ?? null,
        balanceCurrency: view.balance?.currency ?? null,
        requiredAmount: view.required.amount,
        requiredCurrency: view.required.currency,
        currencyMismatch: view.currencyMismatch,
        checkedAt: new Date().toISOString(),
      },
    });
  }

  /**
   * Purchase once using the caller's stable idempotency key.
   *
   * UNKNOWN is intentionally terminal for automation. We cannot know whether the
   * provider charged us, so retrying could buy a second card. It opens an
   * UNKNOWN_OUTCOME work item and returns; only a human can reconcile it.
   */
  async purchase(input: SupplierPurchaseInput): Promise<SupplierPurchaseOutcome> {
    return this.guardedPurchase(input, { refuseWhileAmbiguous: false });
  }

  private async guardedPurchase(
    input: SupplierPurchaseInput,
    options: { readonly refuseWhileAmbiguous: boolean },
  ): Promise<SupplierPurchaseOutcome> {
    if (!Number.isSafeInteger(input.quantity) || input.quantity < 1 || input.quantity > 10) {
      throw DomainErrors.validation([{ path: 'quantity', message: 'quantity must be an integer between 1 and 10' }]);
    }

    /*
     * One purchase per order at a time, in this process.
     *
     * The callers that can reach this concurrently for the same order are all
     * real: a payment callback replayed while the first attempt is still at the
     * supplier, an operator's code request racing the paid-order attempt, a
     * double-clicked request. Each of them re-read "no asset yet" before the
     * supplier round-trip and would happily buy a second card. The API runs as a
     * single process, so serialising here — and re-checking the order's assets
     * once the lock is held — closes that window; the database-level guard in
     * the fulfillment store is the backstop for anything that slips past.
     */
    return this.withOrderPurchaseLock(input.orderId, async () => {
      const guard = await this.fulfillment.purchaseGuardForWorkItem(input.workItemId);
      if (guard.orderId !== input.orderId) {
        throw DomainErrors.conflict(
          'تسک و سفارش با هم مطابقت ندارند.',
          `work item ${input.workItemId} does not belong to order ${input.orderId}`,
        );
      }
      if (guard.assetCount > 0) {
        throw DomainErrors.conflict(
          'برای این سفارش قبلاً دارایی تحویل ثبت شده است.',
          `order ${input.orderId} already has an asset; refusing a second supplier purchase`,
        );
      }
      // Read under the lock: an attempt that just finished UNKNOWN has opened its
      // escalation before releasing it, so a queued caller sees that here.
      if (options.refuseWhileAmbiguous && (await this.store.hasOpenPurchaseAmbiguity(input.orderId))) {
        throw DomainErrors.conflict(
          'نتیجهٔ خرید قبلی این سفارش هنوز نامشخص است؛ پیش از خرید مجدد آن را بررسی و ببندید.',
          `order ${input.orderId} has an open UNKNOWN/PENDING supplier purchase`,
        );
      }
      return this.purchaseUnderLock(input);
    });
  }

  /**
   * A purchase an operator asked for by hand (`POST /operator/suppliers/purchase`).
   *
   * Everything the request body names is checked against the database before a
   * cent is spent, because without that the endpoint let any operator buy any
   * offer, in any quantity, against any order — including a costly card stored on
   * a cheap order they hold, where they can then reveal it. The rules mirror what
   * the automated path already guarantees by construction:
   *
   *   - the work item exists and belongs to the order named;
   *   - the caller holds the claim on it (or is a manager);
   *   - the offer is for the very SKU the order bought, in the quantity it bought;
   *   - the order is paid and deliverable, and has no card yet;
   *   - no earlier purchase for the order is still an open "did we get charged?"
   *     question.
   *
   * The customer id, the quantity and the idempotency key all come from the
   * order on the server, never from the body (Z-FUL-3, FUL-2).
   */
  async purchaseForStaff(input: {
    staff: StaffContext;
    orderId: string;
    workItemId: string;
    offerId: string;
    retry?: boolean;
    recipientEmail?: string;
  }): Promise<SupplierPurchaseOutcome> {
    const target = await this.store.findAutoFulfillmentTarget(input.workItemId);
    if (target === null || target.orderId !== input.orderId) {
      throw DomainErrors.notFound(`work item ${input.workItemId} for order ${input.orderId}`);
    }

    if (!MANAGER_APPROVAL_ROLE_SET.has(input.staff.role) && target.assignedToStaffId !== input.staff.id) {
      throw DomainErrors.forbidden(
        `staff ${input.staff.id} does not hold the claim on work item ${input.workItemId}`,
      );
    }

    if (target.skuId === null) {
      throw DomainErrors.conflict(
        'این سفارش خرید گیفت‌کارت نیست.',
        `order ${input.orderId} is not a SKU purchase`,
      );
    }

    const offer = await this.store.findOfferById(input.offerId);
    if (offer === null || !offer.isActive) {
      throw DomainErrors.notFound(`supplier offer ${input.offerId}`);
    }
    if (offer.skuId !== target.skuId) {
      throw DomainErrors.validation([
        { path: 'offerId', message: 'این پیشنهاد تأمین‌کننده برای محصول همین سفارش نیست.' },
      ]);
    }

    if (!DELIVERABLE_ORDER_STATUSES.some((status) => status === target.orderStatus)) {
      throw DomainErrors.conflict(
        'این سفارش در وضعیت قابل تحویل نیست.',
        `order ${input.orderId} has status ${target.orderStatus}`,
      );
    }
    if (target.assetCount > 0) {
      throw DomainErrors.conflict(
        'برای این سفارش قبلاً دارایی تحویل ثبت شده است.',
        `order ${input.orderId} already has an asset`,
      );
    }

    await this.audit.record({
      actor: input.staff.id,
      actorType: 'STAFF',
      actorRole: input.staff.role,
      action: SUPPLIER_AUDIT_ACTIONS.STAFF_PURCHASE_REQUESTED,
      entity: 'SupplierOffer',
      entityId: offer.id,
      after: {
        orderId: target.orderId,
        workItemId: target.workItemId,
        supplierCode: offer.supplierCode,
        quantity: target.quantity,
        retry: input.retry === true,
      },
    });

    return this.guardedPurchase(
      {
        orderId: target.orderId,
        customerId: target.customerId,
        workItemId: target.workItemId,
        offerId: offer.id,
        quantity: target.quantity,
        requestedByStaffId: input.staff.id,
        ...(input.retry === true ? { retry: true } : {}),
        ...(input.recipientEmail === undefined ? {} : { recipientEmail: input.recipientEmail }),
      },
      // An open "did we get charged?" task for this order means a person still
      // has to answer that before anyone buys again.
      { refuseWhileAmbiguous: true },
    );
  }

  /**
   * A person answers "did the supplier charge us?" for an order whose last
   * purchase is still unsettled (IN_FLIGHT after a crash, PENDING, UNKNOWN).
   *
   * Manager-only: it is the decision that allows buying again. FAILED frees the
   * order for an explicit retry; SUCCEEDED records that the card was obtained
   * and must be entered through the normal supplier-result form.
   */
  async closePurchaseAttempt(input: {
    staff: StaffContext;
    orderId: string;
    outcome: 'FAILED' | 'SUCCEEDED';
    reason: string;
  }): Promise<{ readonly generation: number; readonly status: 'FAILED' | 'SUCCEEDED' }> {
    if (!MANAGER_APPROVAL_ROLE_SET.has(input.staff.role)) {
      throw DomainErrors.forbidden(`staff ${input.staff.id} may not settle a supplier purchase`);
    }
    return this.withOrderPurchaseLock(input.orderId, async () => {
      const latest = await this.store.latestPurchaseAttempt(input.orderId);
      if (latest === null || (latest.status !== 'IN_FLIGHT' && latest.status !== 'UNKNOWN')) {
        throw DomainErrors.conflict(
          'خرید بازی برای بستن وجود ندارد.',
          `order ${input.orderId} has no unsettled supplier purchase`,
        );
      }
      await this.store.settlePurchaseAttempt({
        id: latest.id,
        status: input.outcome,
        errorCode: input.outcome === 'FAILED' ? 'CLOSED_BY_STAFF' : null,
      });
      await this.audit.record({
        actor: input.staff.id,
        actorType: 'STAFF',
        actorRole: input.staff.role,
        action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_ATTEMPT_CLOSED,
        entity: 'Order',
        entityId: input.orderId,
        before: { generation: latest.generation, status: latest.status },
        after: { status: input.outcome, reason: input.reason },
      });
      return { generation: latest.generation, status: input.outcome };
    });
  }

  /** Runs `work` once every earlier purchase for the same order has settled. */
  private async withOrderPurchaseLock<T>(orderId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.purchaseLocks.get(orderId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    this.purchaseLocks.set(orderId, tail);

    await previous;
    try {
      return await work();
    } finally {
      release();
      if (this.purchaseLocks.get(orderId) === tail) {
        this.purchaseLocks.delete(orderId);
      }
    }
  }

  private async purchaseUnderLock(input: SupplierPurchaseInput): Promise<SupplierPurchaseOutcome> {
    const offer = await this.store.findOfferById(input.offerId);
    if (offer === null || !offer.isActive) {
      throw DomainErrors.notFound(`supplier offer ${input.offerId}`);
    }

    const provider = this.providersByKey.get(offer.supplierCode);
    if (provider === undefined) {
      throw DomainErrors.conflict(
        'این تأمین‌کننده اتصال خودکار ندارد و باید به‌صورت دستی پیگیری شود.',
        `no provider adapter registered for ${offer.supplierCode}`,
      );
    }

    /*
     * The durable twin of the in-process lock (FUL-2): the attempt row is
     * written before the supplier hears anything, under a unique "one
     * unsettled purchase per order" slot, with a key derived from the order.
     * A restart, a second process or a replayed request therefore finds the
     * row and stops, instead of buying a second card.
     */
    const latest = await this.store.latestPurchaseAttempt(input.orderId);
    if (latest !== null && (latest.status === 'IN_FLIGHT' || latest.status === 'UNKNOWN')) {
      throw DomainErrors.conflict(
        'نتیجهٔ خرید قبلی این سفارش هنوز مشخص نشده است؛ پیش از خرید دوباره، آن را بررسی و ببندید.',
        `order ${input.orderId} has an unsettled supplier purchase (generation ${latest.generation})`,
      );
    }
    if (latest !== null && latest.status === 'SUCCEEDED') {
      throw DomainErrors.conflict(
        'کارت این سفارش پیش‌تر از تأمین‌کننده خریداری شده است.',
        `order ${input.orderId} already has a successful supplier purchase`,
      );
    }
    if (latest !== null && latest.status === 'FAILED' && input.retry !== true) {
      throw DomainErrors.conflict(
        'خرید قبلی این سفارش ناموفق بود؛ برای خرید دوباره «تلاش مجدد» را انتخاب کنید.',
        `order ${input.orderId}: previous supplier purchase failed and no retry was requested`,
      );
    }
    const generation = latest === null ? 1 : latest.generation + 1;
    const idempotencyKey = purchaseIdempotencyKey(input.orderId, generation);
    const attempt = await this.store.openPurchaseAttempt({
      orderId: input.orderId,
      supplierId: offer.supplierId,
      offerId: offer.id,
      idempotencyKey,
      generation,
      requestedByStaffId: input.requestedByStaffId ?? null,
    });
    if (attempt === null) {
      throw DomainErrors.conflict(
        'خرید دیگری برای این سفارش هم‌زمان در جریان است.',
        `order ${input.orderId}: another process opened purchase generation ${generation}`,
      );
    }

    let result: SupplierPurchaseResult;
    try {
      result = await provider.purchase({
        providerSku: offer.providerSku,
        quantity: input.quantity,
        idempotencyKey,
        ...(input.recipientEmail === undefined ? {} : { recipientEmail: input.recipientEmail }),
        /*
         * Forwarded, not stored: this method is provider-neutral and has no
         * business knowing that a Telegram purchase needs `telegram_username`.
         * Dropping it here was a real bug — the adapter received no account to
         * credit and every top-up failed — so it is passed straight through.
         */
        ...(input.accountFields === undefined ? {} : { accountFields: input.accountFields }),
      });
    } catch {
      // Network ambiguity is UNKNOWN, not FAILED: the provider might have charged
      // us before the connection broke. Never auto-retry this branch.
      result = { status: 'UNKNOWN', failureCode: 'PROVIDER_CONNECTION_AMBIGUOUS' };
    }

    /* PENDING keeps the slot held (IN_FLIGHT): the supplier has the order and
     * will answer later. Only SUCCEEDED and FAILED settle it. */
    await this.store.settlePurchaseAttempt({
      id: attempt.id,
      status: result.status === 'PENDING' ? 'IN_FLIGHT' : result.status,
      providerReference: result.providerReference ?? null,
      errorCode: result.failureCode ?? null,
    });

    const common = {
      supplierId: offer.supplierId,
      supplierCode: offer.supplierCode,
      offerId: offer.id,
      providerReference: result.providerReference ?? null,
    };
    /*
     * A direct top-up has no secret to store, so it is not an asset in the
     * sense the rest of this case means. It should never reach here at all: a
     * top-up order routes to `TopUpFulfillmentService`, which records its
     * outcome in `TopUpFulfillment` and calls the adapter directly. Reaching
     * this line would mean the two paths have been wired together, and the
     * right answer is to say so rather than to write an empty gift card.
     */
    if (result.asset?.assetType === 'DIRECT_TOPUP') {
      throw DomainErrors.conflict(
        'شارژ مستقیم از مسیر خودکار خود ثبت می‌شود، نه به‌عنوان دارایی تحویل.',
        `direct top-up for order ${input.orderId} reached the gift-card ingest path`,
      );
    }

    switch (result.status) {
      case 'SUCCEEDED': {
        if (result.asset === undefined) {
          throw DomainErrors.conflict(
            'پاسخ تأمین‌کننده دارایی تحویل نداشت و نیاز به بررسی دارد.',
            `supplier ${offer.supplierCode} reported SUCCEEDED without an asset`,
          );
        }

        /*
         * The provider response may hold a raw gift-card code. It is handed
         * straight to fulfillment, which encrypts it before it is persisted, and
         * it is deliberately NOT part of this method's return value: the code
         * must not travel back through the controller into an HTTP response.
         */
        const stored = await this.fulfillment.ingestAutomatedSupplierResult({
          workItemId: input.workItemId,
          actorId: `system:supplier:${offer.supplierCode}`,
          supplierId: offer.supplierId,
          supplierReference: result.providerReference ?? null,
          actualSupplierCost: result.cost?.amount ?? null,
          actualSupplierCurrency: result.cost?.currency ?? null,
          skuId: offer.skuId,
          idempotencyKey,
          asset: result.asset,
        });

        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_SUCCEEDED,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: {
            orderId: input.orderId,
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            providerReference: result.providerReference ?? null,
            status: result.status,
            assetId: stored.id,
            assetType: stored.assetType,
            maskedCode: stored.maskedCode,
            cost: result.cost ?? null,
          },
        });

        return {
          ...common,
          status: 'SUCCEEDED',
          cost: result.cost ?? null,
          assetId: stored.id,
          assetType: stored.assetType,
          maskedCode: stored.maskedCode,
        };
      }

      case 'PENDING': {
        const workItem = await this.escalator.openEscalation({
          code: `${PENDING_FOLLOWUP_PREFIX}:${input.orderId}:${idempotencyKey}`,
          orderId: input.orderId,
          customerId: input.customerId,
          type: 'SUPPLIER_FOLLOWUP',
          title: 'پیگیری نتیجهٔ خرید از تأمین‌کننده',
          description: 'خرید در وضعیت انتظار است؛ بدون خرید مجدد نتیجه را پیگیری کنید.',
          payload: {
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            offerId: offer.id,
            providerReference: result.providerReference ?? null,
          },
        });
        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_PENDING,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: { orderId: input.orderId, workItemId: workItem.id, providerReference: result.providerReference ?? null },
        });
        return { ...common, status: 'PENDING', workItemId: workItem.id };
      }

      case 'UNKNOWN': {
        const workItem = await this.escalator.openEscalation({
          code: `${UNKNOWN_OUTCOME_PREFIX}:${input.orderId}:${idempotencyKey}`,
          orderId: input.orderId,
          customerId: input.customerId,
          type: 'UNKNOWN_OUTCOME',
          title: 'نتیجهٔ نامشخص خرید از تأمین‌کننده',
          description: 'وضعیت پرداخت تأمین‌کننده نامشخص است؛ خرید مجدد ممنوع است.',
          payload: {
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            offerId: offer.id,
            providerReference: result.providerReference ?? null,
            purchaseIdempotencyKey: idempotencyKey,
          },
        });
        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_UNKNOWN,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: {
            orderId: input.orderId,
            workItemId: workItem.id,
            providerReference: result.providerReference ?? null,
            failureCode: result.failureCode ?? 'UNKNOWN',
            autoRetry: false,
          },
        });
        return {
          ...common,
          status: 'UNKNOWN',
          workItemId: workItem.id,
          failureCode: result.failureCode ?? null,
        };
      }

      case 'FAILED': {
        await this.audit.record({
          actor: 'system:supplier-purchase',
          actorType: 'SYSTEM',
          action: SUPPLIER_AUDIT_ACTIONS.PURCHASE_FAILED,
          entity: 'SupplierOffer',
          entityId: offer.id,
          after: {
            orderId: input.orderId,
            supplierId: offer.supplierId,
            supplierCode: offer.supplierCode,
            providerReference: result.providerReference ?? null,
            failureCode: result.failureCode ?? 'SUPPLIER_FAILED',
          },
        });
        return {
          ...common,
          status: 'FAILED',
          failureCode: result.failureCode ?? 'SUPPLIER_FAILED',
        };
      }
      default: {
        const exhaustive: never = result.status;
        throw DomainErrors.conflict('نتیجهٔ تأمین‌کننده قابل شناسایی نیست.', `unknown purchase status ${String(exhaustive)}`);
      }
    }
  }

  /**
   * Explicit human reconciliation for a pending / unknown purchase. This method
   * only asks the provider for status; it never calls `purchase`, which preserves
   * the no-auto-retry invariant.
   *
   * The provider's answer is projected onto `SupplierPurchaseStatusView` and NOT
   * returned raw. A `SupplierPurchaseResult` may legitimately carry `asset`, and
   * for Tillo that asset holds a plaintext code and PIN. Returning the provider
   * object verbatim would publish that code in the HTTP response of an operator
   * endpoint, with no `GIFT_CARD_CODE_VIEWED` audit event — the exact leak the
   * encryption-at-rest design exists to prevent. Only the asset's *type* crosses
   * this boundary; the secret itself reaches persistence solely via
   * `ingestAutomatedSupplierResult`, which encrypts it on the way in.
   */
  async checkPurchaseStatus(input: {
    providerCode: string;
    providerReference: string;
  }): Promise<SupplierPurchaseStatusView> {
    const provider = this.providersByKey.get(input.providerCode);
    if (provider === undefined) {
      throw DomainErrors.notFound(`supplier provider ${input.providerCode}`);
    }

    let result: SupplierPurchaseResult;
    try {
      result = await provider.getPurchaseStatus(input.providerReference);
    } catch {
      result = {
        status: 'UNKNOWN',
        providerReference: input.providerReference,
        failureCode: 'STATUS_CHECK_FAILED',
      };
    }

    return toPurchaseStatusView(result, input.providerReference);
  }
}
