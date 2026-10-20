import { Inject, Injectable, Optional } from '@nestjs/common';
import type {
  CreatePaymentRequest,
  PaymentCallbackQuery,
  PaymentDto,
  VerifyPaymentRequest,
  VerifyPaymentResponse,
} from '@barat/contracts';
import type { PaymentAmountUnit, PaymentFailureReason } from '@barat/contracts';
import type { RialPaymentProvider, VerifyResult } from '@barat/payments';
import { RIAL_PAYMENT_PROVIDER } from '@barat/payments';

import { DomainErrors } from '../../common/errors/domain.exception';
import { type AuditActorType, AuditService } from '../audit/audit.service';
/* The port as the work-items module publishes it — the concrete types file, not
 * the barrel, which pulls the Prisma-backed store and would make this service
 * untestable without a database. Payments still knows no fulfillment class. */
import {
  FULFILLMENT_TRIGGER,
  type FulfillmentTrigger,
} from '../workitems/workitems.types';

/** Token used by the composition root to replace the database in tests. */
export const PAYMENTS_DATABASE = Symbol('PAYMENTS_DATABASE');

export interface PaymentDatabase {
  readonly quote: unknown;
  readonly order: unknown;
  readonly payment: unknown;
  readonly paymentAttempt: unknown;
  readonly reconciliationIssue: unknown;
  $transaction<T>(callback: (transaction: PaymentDatabase) => Promise<T>): Promise<T>;
}

interface DbDelegate {
  findUnique(args: Record<string, unknown>): Promise<unknown>;
  findFirst(args: Record<string, unknown>): Promise<unknown>;
  create(args: Record<string, unknown>): Promise<unknown>;
  update(args: Record<string, unknown>): Promise<unknown>;
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>;
  count(args: Record<string, unknown>): Promise<number>;
}

interface PaymentRecord {
  id: string;
  orderId: string;
  customerId: string;
  provider: string;
  status: PaymentStatusName;
  amountIrr: bigint;
  displayAmountToman: bigint;
  providerAuthority: string | null;
  providerRefId: string | null;
  providerRequestCode: number | null;
  providerVerifyCode: number | null;
  providerAmount: unknown;
  providerAmountUnit: PaymentAmountUnit | null;
  providerFee: bigint | null;
  providerFeeType: string | null;
  maskedCard: string | null;
  cardHash: string | null;
  failureReason: PaymentFailureReason | null;
  idempotencyKey: string;
  requestedAt: Date | null;
  redirectedAt: Date | null;
  callbackAt: Date | null;
  verifiedAt: Date | null;
  createdAt: Date;
}

interface OrderRecord {
  id: string;
  orderNumber: string;
  customerId: string;
  quoteId: string;
  status: string;
  totalAmountIrr: bigint;
  displayAmountToman: bigint;
  quote: QuoteRecord;
}

interface QuoteRecord {
  id: string;
  customerId: string | null;
  finalAmountIrr: bigint;
  displayAmountToman: bigint;
  status: string;
  expiresAt: Date;
}

type PaymentStatusName =
  | 'CREATED'
  | 'REDIRECTED'
  | 'PENDING'
  | 'PAID'
  | 'FAILED'
  | 'CANCELLED'
  | 'UNKNOWN'
  | 'REFUND_PENDING'
  | 'REFUNDED';

type PaymentOutcome = VerifyPaymentResponse['outcome'];

const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatusName, readonly PaymentStatusName[]>> = {
  CREATED: ['REDIRECTED', 'PENDING', 'FAILED', 'CANCELLED', 'UNKNOWN'],
  REDIRECTED: ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'UNKNOWN'],
  PENDING: ['PAID', 'FAILED', 'CANCELLED', 'UNKNOWN'],
  PAID: ['REFUND_PENDING'],
  FAILED: ['PENDING'],
  CANCELLED: ['PENDING'],
  UNKNOWN: ['PENDING', 'REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};

export const PAYMENT_STATUS_TRANSITIONS = PAYMENT_TRANSITIONS;

/** Order statuses that may still open a payment session (orders' state machine). */
const PAYABLE_ORDER_STATUSES: ReadonlySet<string> = new Set(['AWAITING_PAYMENT', 'PAYMENT_PENDING']);

/** Local payment statuses a verified gateway result may commit to PAID. */
const COMMITTABLE_PAYMENT_STATUSES: readonly PaymentStatusName[] = ['CREATED', 'REDIRECTED', 'PENDING'];

/**
 * Order statuses the PAID write may move forward from. Everything after PAID is
 * a money-moved status that a late or duplicate verification must never rewind.
 * CANCELLED / FAILED keep their historical behaviour (the verified payment wins)
 * but are flagged for reconciliation.
 */
const ORDER_STATUSES_ALREADY_PAST_PAYMENT: ReadonlySet<string> = new Set([
  'PAID',
  'FULFILLMENT_PENDING',
  'FULFILLING',
  'FULFILLED',
  'REVIEW_REQUIRED',
  'REFUND_PENDING',
  'REFUNDED',
]);

/** Bounded so a long-running process does not grow this cache without limit. */
const REDIRECT_URL_CACHE_LIMIT = 2_000;
const ATTEMPT_WRITE_RETRIES = 5;

/**
 * Check a state transition in one place. `UNKNOWN -> PAID` is intentionally not
 * in the map: only a separately controlled reconciliation operation may perform
 * that transition.
 */
export function assertPaymentTransition(
  from: PaymentStatusName,
  to: PaymentStatusName,
  context: 'callback' | 'reconciliation' = 'callback',
): void {
  if (from === 'UNKNOWN' && to === 'PAID' && context === 'reconciliation') return;
  if (!PAYMENT_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Illegal payment transition ${from} -> ${to}`);
  }
}

/** Provider-neutral payment orchestration and callback verification. */
@Injectable()
export class PaymentsService {
  private readonly db: PaymentDatabase;
  private readonly fulfillmentTrigger: FulfillmentTrigger;
  private readonly redirectUrls = new Map<string, string>();
  private readonly paymentLocks = new Map<string, Promise<void>>();

  constructor(
    @Inject(RIAL_PAYMENT_PROVIDER) private readonly provider: RialPaymentProvider,
    // Always injected. The service never imports the Prisma singleton itself, so
    // a unit test can drive the whole flow without a live database.
    @Inject(PAYMENTS_DATABASE) database: PaymentDatabase,
    @Optional() @Inject(AuditService) private readonly auditService: AuditService | undefined,
    /* Deliberately NOT @Optional(). This used to fall back to a silent no-op,
     * which is how a mismatched token went unnoticed: every order reached PAID
     * and no fulfillment work item was ever created, so nobody was tasked with
     * delivering the card. A missing binding must break the boot, loudly. */
    @Inject(FULFILLMENT_TRIGGER) fulfillmentTrigger: FulfillmentTrigger,
  ) {
    this.db = database;
    this.fulfillmentTrigger = fulfillmentTrigger;
  }

  /**
   * Reserve the payment idempotency key before contacting the gateway. This
   * closes the race where two browser requests could both open a gateway session.
   */
  async createPayment(
    input: CreatePaymentRequest,
    customerId: string,
    callbackUrl: string,
  ): Promise<{ payment: PaymentDto; redirectUrl: string; created: boolean }> {
    const paymentDelegate = this.delegate(this.db.payment);
    const existing = await paymentDelegate.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing !== null) return this.replayCreate(existing, input, customerId);

    let reservation: PaymentRecord;
    try {
      reservation = await this.reservePayment(input, customerId);
    } catch (error) {
      /* Two requests carrying the same key can both miss the read above; the
       * unique index then refuses the second insert. That is a replay, not a
       * server error: answer it with the payment the first request reserved. */
      const raced = await paymentDelegate.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (raced !== null) return this.replayCreate(raced, input, customerId);
      throw error;
    }
    return this.openGatewaySession(reservation, input, callbackUrl);
  }

  private replayCreate(
    existing: unknown,
    input: CreatePaymentRequest,
    customerId: string,
  ): { payment: PaymentDto; redirectUrl: string; created: boolean } {
    const payment = this.asPayment(existing);
    if (payment.orderId !== input.orderId || payment.customerId !== customerId) {
      throw DomainErrors.idempotencyConflict('Payment idempotency key belongs to another order');
    }
    return {
      payment: toPaymentDto(payment),
      redirectUrl: this.redirectUrlFor(payment),
      created: false,
    };
  }

  private async reservePayment(input: CreatePaymentRequest, customerId: string): Promise<PaymentRecord> {
    return this.db.$transaction(async (transaction) => {
      const orderDelegate = this.delegate(transaction.order);
      const quoteDelegate = this.delegate(transaction.quote);
      const paymentTx = this.delegate(transaction.payment);
      const order = await orderDelegate.findUnique({
        where: { id: input.orderId },
        include: { quote: true },
      });
      if (order === null) throw DomainErrors.notFound('Order');
      const orderRecord = this.asOrder(order);
      const quote = orderRecord.quote;

      this.assertQuoteOwnershipAndAmount(quote, orderRecord, customerId);

      /* Only an order that is still waiting for its money may open a gateway
       * session. Paying into a CANCELLED/FAILED order would bring it back as
       * PAID (the commit below writes the order by id), and paying into a
       * fulfilled or refunded one takes money for nothing. */
      if (!PAYABLE_ORDER_STATUSES.has(orderRecord.status)) {
        throw DomainErrors.conflict(
          'این سفارش دیگر قابل پرداخت نیست.',
          `Order status ${orderRecord.status} does not accept a payment`,
        );
      }

      const successfulPayment = await paymentTx.findFirst({
        where: { orderId: input.orderId, status: 'PAID' },
      });
      if (successfulPayment !== null) {
        throw DomainErrors.conflict('این سفارش قبلاً پرداخت شده است.', 'Order already has a paid payment');
      }

      // ACCEPTED is the persisted freeze marker. Once payment is reserved, the
      // quote is never re-priced or changed by this flow.
      if (quote.status === 'ACTIVE') {
        await quoteDelegate.update({
          where: { id: quote.id },
          data: { status: 'ACCEPTED', acceptedAt: new Date() },
        });
      }

      const created = await paymentTx.create({
        data: {
          orderId: orderRecord.id,
          customerId,
          provider: this.provider.name,
          status: 'CREATED',
          amountIrr: quote.finalAmountIrr,
          displayAmountToman: quote.displayAmountToman,
          idempotencyKey: input.idempotencyKey,
          requestedAt: new Date(),
        },
      });
      return this.asPayment(created);
    });
  }

  private async openGatewaySession(
    reservation: PaymentRecord,
    input: CreatePaymentRequest,
    callbackUrl: string,
  ): Promise<{ payment: PaymentDto; redirectUrl: string; created: boolean }> {
    let providerResult;
    try {
      providerResult = await this.provider.createPayment({
        amountIrr: reservation.amountIrr,
        orderNumber: await this.orderNumber(input.orderId),
        description: `CENTO order ${input.orderId}`,
        callbackUrl,
        idempotencyKey: input.idempotencyKey,
      });
    } catch {
      providerResult = {
        ok: false as const,
        providerCode: null,
        failureReason: 'PROVIDER_NETWORK_ERROR' as const,
      };
    }

    if (!providerResult.ok) {
      const status: PaymentStatusName =
        providerResult.failureReason === 'PROVIDER_TIMEOUT' ? 'UNKNOWN' : 'FAILED';
      const payment = await this.recordCreateFailure(reservation, status, providerResult.failureReason, providerResult.providerCode);
      return { payment: toPaymentDto(payment), redirectUrl: '', created: true };
    }

    const payment = await this.recordRedirect(reservation, providerResult);
    this.rememberRedirectUrl(payment.id, providerResult.redirectUrl);
    return { payment: toPaymentDto(payment), redirectUrl: providerResult.redirectUrl, created: true };
  }

  /**
   * Process a gateway callback. Query values only select the stored payment; the
   * stored amount is the sole input to server-to-server verification.
   */
  async callback(
    query: PaymentCallbackQuery,
    context: { readonly ip?: string | null; readonly userAgent?: string | null } = {},
  ): Promise<VerifyPaymentResponse | CallbackFailureResponse> {
    const authority = query.Authority ?? query.authority;
    const callbackStatus = query.Status ?? query.status;
    if (!authority) {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CALLBACK_INVALID',
        entity: 'Payment',
        entityId: 'unknown',
        after: { reason: 'missing_authority' },
        ...context,
      });
      return safeCallbackFailure('UNKNOWN');
    }

    const paymentDelegate = this.delegate(this.db.payment);
    const paymentRaw = await paymentDelegate.findUnique({
      where: {
        provider_providerAuthority: {
          provider: this.provider.name,
          providerAuthority: authority,
        },
      },
    });
    if (paymentRaw === null) {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CALLBACK_UNKNOWN_AUTHORITY',
        entity: 'Payment',
        entityId: 'unknown',
        after: { reason: 'unknown_authority', authorityHash: shortHash(authority) },
        ...context,
      });
      return safeCallbackFailure('FAILED');
    }

    const located = this.asPayment(paymentRaw);
    await this.recordAttempt(located.id, 'CALLBACK', callbackStatus === 'OK' ? 'OK' : 'FAILED', null, context);

    return this.withPaymentLock(located.id, async () => {
      const payment = await this.reload(located);
      if (payment.status === 'PAID') {
        return this.responseForPayment(payment, 'PAID', false);
      }

      if (callbackStatus !== 'OK') {
        const reason = normalizeCallbackFailure(callbackStatus);
        const updated = await this.transitionFailure(payment, reason, reason === 'CUSTOMER_CANCELLED' ? 'CANCELLED' : 'FAILED');
        return this.responseForPayment(updated, reason === 'CUSTOMER_CANCELLED' ? 'CANCELLED' : 'FAILED', true);
      }

      const result = await this.verifyStoredPayment(payment);
      return this.applyVerificationResult(payment, result, context);
    });
  }

  /** Explicit server-side verification endpoint; request amount is never accepted. */
  async verifyPayment(
    input: VerifyPaymentRequest,
    customerId?: string,
    context: { readonly ip?: string | null; readonly userAgent?: string | null } = {},
  ): Promise<VerifyPaymentResponse> {
    const paymentDelegate = this.delegate(this.db.payment);
    let raw: unknown = null;
    if (input.paymentId) {
      raw = await paymentDelegate.findUnique({ where: { id: input.paymentId } });
    } else if (input.providerAuthority) {
      raw = await paymentDelegate.findUnique({
        where: {
          provider_providerAuthority: {
            provider: input.provider ?? this.provider.name,
            providerAuthority: input.providerAuthority,
          },
        },
      });
    }
    if (raw === null) throw DomainErrors.notFound('Payment');

    const located = this.asPayment(raw);
    if (customerId !== undefined && located.customerId !== customerId) {
      throw DomainErrors.notFound('Payment');
    }
    return this.withPaymentLock(located.id, async () => {
      const payment = await this.reload(located);
      if (payment.status === 'PAID') return this.responseForPayment(payment, 'PAID', false);

      const result = await this.verifyStoredPayment(payment);
      return this.applyVerificationResult(payment, result, context);
    });
  }

  /**
   * Run one verification of one payment at a time in this process.
   *
   * ZarinPal settles inside `verify` and answers every later verify of the same
   * authority with 101. Two overlapping verifications of one payment (the
   * gateway callback and the result page's POST /verify, a double click, a
   * retried request) used to race: the loser got 101 before the winner had
   * written PAID, judged that a local-state mismatch and parked the payment in
   * UNKNOWN, so the winner's PAID write then matched nothing — the customer was
   * charged and fulfillment never started. Queueing them means the second one
   * re-reads a committed PAID and never asks the gateway at all.
   *
   * The database guards (status compare-and-set) remain the cross-process
   * protection; this only removes the in-process overlap that made them fire.
   */
  private async withPaymentLock<T>(paymentId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.paymentLocks.get(paymentId) ?? Promise.resolve();
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => held);
    this.paymentLocks.set(paymentId, tail);
    try {
      await previous;
      return await work();
    } finally {
      release();
      if (this.paymentLocks.get(paymentId) === tail) this.paymentLocks.delete(paymentId);
    }
  }

  /** The current row, read inside the payment lock rather than trusting a snapshot. */
  private async reload(payment: PaymentRecord): Promise<PaymentRecord> {
    const current = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
    if (current === null) throw DomainErrors.notFound('Payment');
    return this.asPayment(current);
  }

  private async verifyStoredPayment(payment: PaymentRecord): Promise<VerifyResult> {
    if (!payment.providerAuthority) {
      return { outcome: 'UNKNOWN', providerCode: null, failureReason: 'INVALID_AUTHORITY' };
    }
    await this.recordAttempt(payment.id, 'VERIFY', 'PENDING', null);
    try {
      return await this.provider.verifyPayment({
        authority: payment.providerAuthority,
        amountIrr: payment.amountIrr,
      });
    } catch {
      return { outcome: 'UNKNOWN', providerCode: null, failureReason: 'PROVIDER_NETWORK_ERROR' };
    }
  }

  private async applyVerificationResult(
    payment: PaymentRecord,
    result: VerifyResult,
    context: { readonly ip?: string | null; readonly userAgent?: string | null },
  ): Promise<VerifyPaymentResponse> {
    if (result.outcome === 'ALREADY_VERIFIED') {
      // Re-read before judging. A concurrent callback for the same authority may
      // have committed PAID between loading this snapshot and the provider
      // answering 101; that is the normal, benign cause of code 101.
      const currentRaw = await this.delegate(this.db.payment).findUnique({
        where: { id: payment.id },
      });
      const current = currentRaw === null ? payment : this.asPayment(currentRaw);
      const matchingLocalPayment =
        current.status === 'PAID' &&
        current.providerAuthority === result.authority &&
        safeProviderAmountToIrr(result.providerAmount, result.providerAmountUnit) === current.amountIrr;
      if (matchingLocalPayment) return this.responseForPayment(current, 'ALREADY_VERIFIED', false);

      const updated = await this.markAlreadyVerifiedMismatch(current, result, context);
      return this.responseForPayment(updated, 'UNKNOWN', true);
    }

    if (result.outcome !== 'VERIFIED') {
      const target: PaymentStatusName =
        result.failureReason === 'PROVIDER_TIMEOUT' || result.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED';
      const updated = await this.transitionFailure(payment, result.failureReason, target);
      return this.responseForPayment(updated, target === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED', true);
    }

    let reportedAmountIrr: bigint;
    try {
      reportedAmountIrr = providerAmountToIrr(result.providerAmount, result.providerAmountUnit);
    } catch {
      reportedAmountIrr = -1n;
    }
    const storedProviderAmount = decimalToBigInt(payment.providerAmount);
    if (
      reportedAmountIrr !== payment.amountIrr ||
      (storedProviderAmount !== null &&
        (storedProviderAmount !== result.providerAmount || payment.providerAmountUnit !== result.providerAmountUnit))
    ) {
      await this.recordAmountMismatch(payment, reportedAmountIrr);
      const updated = await this.transitionFailure(payment, 'AMOUNT_MISMATCH', 'FAILED');
      return this.responseForPayment(updated, 'FAILED', true);
    }

    // A timeout/unknown state cannot be promoted by a callback. This is the one
    // high-risk transition reserved for an authenticated reconciliation action.
    if (payment.status === 'UNKNOWN') {
      await this.createReconciliationIssue(payment, 'UNKNOWN_PAYMENT_STATE', {
        reason: 'verified_provider_while_local_payment_unknown',
        providerCode: 100,
      });
      return this.responseForPayment(payment, 'UNKNOWN', true);
    }
    if (payment.status === 'PAID') return this.responseForPayment(payment, 'PAID', false);

    /* The gateway says this authority is paid, but our row already closed as
     * FAILED / CANCELLED (an earlier non-OK callback, a failed verify) or is in
     * a refund state. The state machine has no edge to PAID from there, and this
     * used to surface as an uncaught "Illegal payment transition" 500 — after a
     * single-phase gateway had already settled the money, with no trace left.
     * The status is not rewritten; a person decides, with the evidence recorded. */
    if (!COMMITTABLE_PAYMENT_STATUSES.includes(payment.status)) {
      await this.flagVerifiedButNotCommittable(payment, 'verified_provider_while_local_payment_closed', context);
      return this.responseForPayment(payment, 'UNKNOWN', true);
    }

    const committed = await this.commitSuccessfulPayment(payment, result);
    if (!committed.transitioned && committed.payment.status !== 'PAID') {
      /* The compare-and-set lost to a writer that moved the row somewhere other
       * than PAID while the gateway was answering. Reporting PAID here would tell
       * the customer they paid for an order nobody will fulfil. */
      await this.flagVerifiedButNotCommittable(committed.payment, 'verified_provider_but_local_state_changed', context);
      return this.responseForPayment(committed.payment, 'UNKNOWN', true);
    }
    if (committed.transitioned) {
      /* A two-phase gateway only finalises the charge when we say so, and it
       * hands the money back on its own if we never do. That call is made here —
       * after PAID is durably written and before fulfillment starts — so the
       * gateway can never hold a committed charge our own database does not know
       * about, nor can we deliver on an uncommitted one that is about to be
       * refunded. If the commit does not go through, the order is NOT started. */
      if (this.provider.confirmPayment !== undefined) {
        const confirmed = await this.confirmWithGateway(committed.payment);
        if (!confirmed) return this.responseForPayment(committed.payment, 'UNKNOWN', true);
      }
      /* Called AFTER the payment transaction commits, never inside it: a
       * rolled-back payment would otherwise leave an operator holding work for
       * an order that was never paid. `onOrderPaid` is idempotent per order, so
       * a replayed callback still produces exactly one work item.
       *
       * A second PAID payment for an order that is already paid is a duplicate
       * charge awaiting a refund decision, not a second purchase: the order was
       * handed to fulfillment by the first payment, so it is not handed again.
       *
       * `payload` carries operator context only — never a code, PIN or token. */
      if (!committed.duplicate) {
        await this.fulfillmentTrigger.onOrderPaid({
          orderId: payment.orderId,
          customerId: payment.customerId,
          payload: { paymentId: payment.id },
        });
      }
    }
    // `verified` means "this call performed the verification". A replay that
    // found the payment already committed reports false.
    return this.responseForPayment(committed.payment, 'PAID', committed.transitioned);
  }

  private async flagVerifiedButNotCommittable(
    payment: PaymentRecord,
    reason: string,
    context: { readonly ip?: string | null; readonly userAgent?: string | null },
  ): Promise<void> {
    await this.createReconciliationIssue(payment, 'VERIFIED_AT_GATEWAY_LOCAL_NOT_PAYABLE', {
      reason,
      localStatus: payment.status,
      providerCode: 100,
    });
    await this.recordAudit({
      actor: 'system:payments',
      actorType: 'SYSTEM',
      action: 'PAYMENT_VERIFIED_LOCAL_STATE_NOT_PAYABLE',
      entity: 'Payment',
      entityId: payment.id,
      after: { localStatus: payment.status, reason },
      ...context,
    });
  }

  /**
   * Finalise a two-phase charge. Returns false when the gateway did not confirm,
   * after leaving a HIGH reconciliation issue: the money is held by us on a
   * payment that may be refunded to the customer's wallet, and a person has to
   * decide, not a retry loop.
   */
  private async confirmWithGateway(payment: PaymentRecord): Promise<boolean> {
    const confirm = this.provider.confirmPayment;
    if (confirm === undefined || payment.providerAuthority === null) return true;
    let confirmed = false;
    let providerCode: number | null = null;
    try {
      const result = await confirm.call(this.provider, { authority: payment.providerAuthority });
      confirmed = result.confirmed;
      if (!result.confirmed) providerCode = result.providerCode;
    } catch {
      /* Ambiguous: the commit may have landed. Treated as not confirmed. */
    }
    await this.recordAttempt(payment.id, 'CONFIRM', confirmed ? 'OK' : 'FAILED', providerCode);
    if (confirmed) return true;
    await this.createReconciliationIssue(payment, 'GATEWAY_COMMIT_NOT_CONFIRMED', {
      providerCode: providerCode ?? 0,
    });
    await this.recordAudit({
      actor: 'system:payments',
      actorType: 'SYSTEM',
      action: 'PAYMENT_COMMIT_NOT_CONFIRMED',
      entity: 'Payment',
      entityId: payment.id,
      after: { provider: payment.provider },
    });
    return false;
  }

  /**
   * The customer's browser coming back from a hosted gateway page.
   *
   * Everything in the query is untrusted and is used only to find a payment we
   * already stored; the outcome comes from a server-to-server verify. The
   * payment is matched on the token AND this provider, so a token that belongs
   * to nobody, or to another gateway, is a `FAILED` that touches nothing.
   *
   * Returns the ids the result page needs. No payment detail, status text or
   * gateway value is reflected into the redirect.
   */
  async handleReturn(
    query: { readonly token?: string | undefined },
    context: { readonly ip?: string | null; readonly userAgent?: string | null } = {},
  ): Promise<{ readonly paymentId: string | null; readonly orderNumber: string | null }> {
    const token = query.token;
    if (token === undefined || !/^[A-Za-z0-9]{1,128}$/u.test(token)) {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CALLBACK_INVALID',
        entity: 'Payment',
        entityId: 'unknown',
        after: { reason: 'missing_or_malformed_token' },
        ...context,
      });
      return { paymentId: null, orderNumber: null };
    }

    const raw = await this.delegate(this.db.payment).findUnique({
      where: {
        provider_providerAuthority: { provider: this.provider.name, providerAuthority: token },
      },
    });
    if (raw === null) {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CALLBACK_UNKNOWN_AUTHORITY',
        entity: 'Payment',
        entityId: 'unknown',
        after: { reason: 'unknown_authority', authorityHash: shortHash(token) },
        ...context,
      });
      return { paymentId: null, orderNumber: null };
    }

    const payment = this.asPayment(raw);
    await this.recordAttempt(payment.id, 'CALLBACK', 'RETURNED', null, context);
    await this.withPaymentLock(payment.id, async () => {
      const current = await this.reload(payment);
      if (current.status === 'PAID') return;
      /* The browser reaching us proves nothing; ask the gateway. */
      const result = await this.verifyStoredPayment(current);
      await this.applyVerificationResult(current, result, context);
    });
    return { paymentId: payment.id, orderNumber: await this.orderNumber(payment.orderId) };
  }

  private async commitSuccessfulPayment(
    payment: PaymentRecord,
    result: Extract<VerifyResult, { outcome: 'VERIFIED' }>,
  ): Promise<{ payment: PaymentRecord; transitioned: boolean; duplicate: boolean }> {
    assertPaymentTransition(payment.status, 'PAID');
    const now = new Date();
    const committed = await this.db.$transaction(async (transaction) => {
      const paymentTx = this.delegate(transaction.payment);
      const orderTx = this.delegate(transaction.order);
      const changed = await paymentTx.updateMany({
        where: {
          id: payment.id,
          status: { in: [...COMMITTABLE_PAYMENT_STATUSES] },
          providerAuthority: result.authority,
          amountIrr: payment.amountIrr,
        },
        data: {
          status: 'PAID',
          providerVerifyCode: 100,
          providerRefId: result.refId,
          providerAmount: result.providerAmount.toString(),
          providerAmountUnit: result.providerAmountUnit,
          providerFee: result.providerFeeIrr,
          providerFeeType: result.providerFeeType,
          maskedCard: result.maskedCard,
          cardHash: result.cardHash,
          failureReason: null,
          verifiedAt: now,
        },
      });
      if (changed.count === 0) {
        const current = await paymentTx.findUnique({ where: { id: payment.id } });
        if (current === null) throw DomainErrors.notFound('Payment');
        return { payment: this.asPayment(current), transitioned: false, duplicate: false };
      }

      /* Two sessions opened for one order (two tabs, two devices) can both be
       * paid. The second charge is real money and stays recorded as PAID, but it
       * is a duplicate a person must refund — never a reason to rewind the order
       * or to queue the order for fulfillment a second time. */
      const otherPaid = await paymentTx.findFirst({
        where: { orderId: payment.orderId, status: 'PAID', id: { not: payment.id } },
      });
      const duplicate = otherPaid !== null;
      if (duplicate) {
        await this.createReconciliationIssueInTransaction(
          transaction,
          payment,
          { reason: 'DUPLICATE_PAYMENT_FOR_ORDER', firstPaymentId: this.asPayment(otherPaid).id },
          'duplicate_payment',
        );
      }

      const order = await orderTx.findUnique({ where: { id: payment.orderId } });
      if (order === null) throw DomainErrors.notFound('Order');
      const orderRecord = this.asOrderWithoutQuote(order);
      // The PAID transition is deliberately recorded once. Fulfillment consumes
      // the post-commit event and advances the order to FULFILLMENT_PENDING; a
      // late verification must never pull an order back from there.
      if (!ORDER_STATUSES_ALREADY_PAST_PAYMENT.has(orderRecord.status)) {
        if (orderRecord.status === 'CANCELLED' || orderRecord.status === 'FAILED') {
          /* Historical behaviour is kept — a verified payment wins — but an order
           * coming back from a closed status is never silent. */
          await this.createReconciliationIssueInTransaction(transaction, payment, {
            reason: 'PAYMENT_VERIFIED_FOR_CLOSED_ORDER',
            orderStatus: orderRecord.status,
          });
        }
        await orderTx.update({
          where: { id: payment.orderId },
          data: { status: 'PAID', paidAt: now },
        });
      }
      const updated = await paymentTx.findUnique({ where: { id: payment.id } });
      if (updated === null) throw DomainErrors.notFound('Payment');
      return { payment: this.asPayment(updated), transitioned: true, duplicate };
    });
    return committed;
  }

  private async markAlreadyVerifiedMismatch(
    payment: PaymentRecord,
    result: Extract<VerifyResult, { outcome: 'ALREADY_VERIFIED' }>,
    context: { readonly ip?: string | null; readonly userAgent?: string | null },
  ): Promise<PaymentRecord> {
    const updated = await this.db.$transaction(async (transaction) => {
      const paymentTx = this.delegate(transaction.payment);
      const current = await paymentTx.findUnique({ where: { id: payment.id } });
      if (current === null) throw DomainErrors.notFound('Payment');
      const currentPayment = this.asPayment(current);
      if (currentPayment.status === 'PAID') return currentPayment;
      const changed = await paymentTx.updateMany({
        where: { id: payment.id, status: { in: ['CREATED', 'REDIRECTED', 'PENDING', 'FAILED', 'CANCELLED', 'UNKNOWN'] } },
        data: { status: 'UNKNOWN', providerVerifyCode: 101, failureReason: 'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH' },
      });
      if (changed.count === 0) return currentPayment;
      await this.createReconciliationIssueInTransaction(transaction, payment, {
        reason: 'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH',
        providerCode: result.providerCode,
      });
      return this.asPayment((await paymentTx.findUnique({ where: { id: payment.id } })) ?? current);
    });
    await this.recordAudit({
      actor: 'system:payments',
      actorType: 'SYSTEM',
      action: 'PAYMENT_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH',
      entity: 'Payment',
      entityId: payment.id,
      after: { status: 'UNKNOWN', providerCode: 101 },
      ...context,
    });
    return updated;
  }

  private async recordAmountMismatch(payment: PaymentRecord, actualAmountIrr: bigint): Promise<void> {
    await this.recordAudit({
      actor: 'system:payments',
      actorType: 'SYSTEM',
      action: 'AMOUNT_MISMATCH',
      entity: 'Payment',
      entityId: payment.id,
      before: { expectedAmountIrr: payment.amountIrr.toString() },
      after: { actualAmountIrr: actualAmountIrr.toString() },
    });
    await this.createReconciliationIssue(payment, 'AMOUNT_MISMATCH', {
      expectedAmountIrr: payment.amountIrr.toString(),
      actualAmountIrr: actualAmountIrr.toString(),
    });
  }

  private async transitionFailure(
    payment: PaymentRecord,
    reason: PaymentFailureReason,
    target: 'FAILED' | 'CANCELLED' | 'UNKNOWN',
  ): Promise<PaymentRecord> {
    if (payment.status === target) return payment;
    /* A failure signal arriving for a payment that has already closed some other
     * way (UNKNOWN, CANCELLED after FAILED, a refund state) changes nothing. It
     * used to throw, turning a late or replayed callback into a 500. */
    if (!PAYMENT_TRANSITIONS[payment.status]?.includes(target)) return payment;
    const changed = await this.delegate(this.db.payment).updateMany({
      where: { id: payment.id, status: payment.status },
      data: { status: target, failureReason: reason },
    });
    if (changed.count === 0) {
      const current = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
      if (current === null) throw DomainErrors.notFound('Payment');
      return this.asPayment(current);
    }
    const updated = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
    if (updated === null) throw DomainErrors.notFound('Payment');
    return this.asPayment(updated);
  }

  private async recordCreateFailure(
    payment: PaymentRecord,
    status: 'FAILED' | 'UNKNOWN',
    reason: PaymentFailureReason,
    providerCode: number | null,
  ): Promise<PaymentRecord> {
    const changed = await this.delegate(this.db.payment).updateMany({
      where: { id: payment.id, status: 'CREATED' },
      data: { status, failureReason: reason, providerRequestCode: providerCode },
    });
    if (changed.count === 0) {
      const current = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
      if (current === null) throw DomainErrors.notFound('Payment');
      return this.asPayment(current);
    }
    const result = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
    if (result === null) throw DomainErrors.notFound('Payment');
    return this.asPayment(result);
  }

  private async recordRedirect(
    payment: PaymentRecord,
    result: Extract<Awaited<ReturnType<RialPaymentProvider['createPayment']>>, { ok: true }>,
  ): Promise<PaymentRecord> {
    assertPaymentTransition(payment.status, 'REDIRECTED');
    const changed = await this.delegate(this.db.payment).updateMany({
      where: { id: payment.id, status: 'CREATED' },
      data: {
        status: 'REDIRECTED',
        providerAuthority: result.authority,
        providerRequestCode: result.providerCode,
        providerAmount: result.providerAmount.toString(),
        providerAmountUnit: result.providerAmountUnit,
        providerFee: result.providerFeeIrr,
        providerFeeType: result.providerFeeType,
        redirectedAt: new Date(),
      },
    });
    if (changed.count === 0) {
      const current = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
      if (current === null) throw DomainErrors.notFound('Payment');
      return this.asPayment(current);
    }
    const updated = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
    if (updated === null) throw DomainErrors.notFound('Payment');
    return this.asPayment(updated);
  }

  private async recordAttempt(
    paymentId: string,
    action: string,
    status: string,
    providerCode: number | null,
    context: { readonly ip?: string | null; readonly userAgent?: string | null } = {},
  ): Promise<void> {
    const delegate = this.delegate(this.db.paymentAttempt);
    /* `attemptNumber` is derived from a count, so two requests touching the same
     * payment at once compute the same number and the unique index refuses one
     * of them. Losing that race must not abort a money flow — in particular the
     * CONFIRM attempt, which is written after the gateway committed and before
     * fulfillment starts. Recount and retry. */
    for (let attempt = 1; ; attempt += 1) {
      const count = await delegate.count({ where: { paymentId } });
      try {
        await delegate.create({
          data: {
            paymentId,
            attemptNumber: count + 1,
            action,
            status,
            providerCode,
            ip: context.ip ?? null,
            userAgent: context.userAgent ?? null,
          },
        });
        return;
      } catch (error) {
        if (attempt >= ATTEMPT_WRITE_RETRIES || !isUniqueViolation(error)) throw error;
      }
    }
  }

  private async createReconciliationIssue(
    payment: PaymentRecord,
    reason: string,
    details: Record<string, string | number>,
  ): Promise<void> {
    await this.db.$transaction(async (transaction) => {
      await this.createReconciliationIssueInTransaction(transaction, payment, { reason, ...details });
      return undefined;
    });
  }

  private async createReconciliationIssueInTransaction(
    transaction: PaymentDatabase,
    payment: PaymentRecord,
    details: Record<string, string | number>,
    type: 'unknown_payment' | 'duplicate_payment' = 'unknown_payment',
  ): Promise<void> {
    // The frozen Prisma enum does not yet contain the requested dedicated 101
    // issue value. `unknown_payment` is the safe valid bucket; details retains
    // the exact machine-readable subtype until Foundation adds that enum value.
    await this.delegate(transaction.reconciliationIssue).create({
      data: {
        type,
        severity: 'HIGH',
        paymentId: payment.id,
        orderId: payment.orderId,
        expectedAmountIrr: payment.amountIrr,
        details,
      },
    });
  }

  private assertQuoteOwnershipAndAmount(quote: QuoteRecord, order: OrderRecord, customerId: string): void {
    if (order.customerId !== customerId || (quote.customerId !== null && quote.customerId !== customerId)) {
      throw DomainErrors.notFound('Order');
    }
    if (quote.status !== 'ACTIVE' && quote.status !== 'ACCEPTED') {
      if (quote.status === 'EXPIRED' || quote.expiresAt.getTime() <= Date.now()) throw DomainErrors.quoteExpired();
      throw DomainErrors.conflict('این پیش‌فاکتور دیگر قابل استفاده نیست.', `Quote status ${quote.status}`);
    }
    if (quote.expiresAt.getTime() <= Date.now()) throw DomainErrors.quoteExpired();
    if (quote.finalAmountIrr !== order.totalAmountIrr) {
      /* Fire-and-forget, so it must not reject unobserved: an unhandled
       * rejection terminates the Node process. */
      this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'AMOUNT_MISMATCH',
        entity: 'Order',
        entityId: order.id,
        before: { quoteAmountIrr: quote.finalAmountIrr.toString(), orderAmountIrr: order.totalAmountIrr.toString() },
      }).catch(() => undefined);
      throw DomainErrors.amountMismatch('Quote amount does not equal order total');
    }
  }

  private async orderNumber(orderId: string): Promise<string> {
    const order = await this.delegate(this.db.order).findUnique({ where: { id: orderId } });
    if (order === null) return orderId;
    return this.asOrderWithoutQuote(order).orderNumber;
  }

  private rememberRedirectUrl(paymentId: string, url: string): void {
    this.redirectUrls.set(paymentId, url);
    while (this.redirectUrls.size > REDIRECT_URL_CACHE_LIMIT) {
      const oldest = this.redirectUrls.keys().next();
      if (oldest.done === true) break;
      this.redirectUrls.delete(oldest.value);
    }
  }

  private redirectUrlFor(payment: PaymentRecord): string {
    const existing = this.redirectUrls.get(payment.id);
    if (existing) return existing;
    if (!payment.providerAuthority) return '';
    if (payment.provider === 'zarinpal') {
      return `https://www.zarinpal.com/pg/StartPay/${encodeURIComponent(payment.providerAuthority)}`;
    }
    if (payment.provider === 'mock') {
      return `https://mock-gateway.invalid/start/${payment.providerAuthority}`;
    }
    /* BazaarPay's hosted page carries our return URL, which only the adapter
     * knows, so it cannot be rebuilt here. A replayed request in a process that
     * has since restarted returns no destination and the customer is sent to the
     * result page, which asks the gateway for the real state. */
    return '';
  }

  private responseForPayment(payment: PaymentRecord, outcome: PaymentOutcome, verified: boolean): VerifyPaymentResponse {
    return {
      payment: toPaymentDto(payment),
      orderId: payment.orderId,
      outcome,
      verified,
      messageFa: messageForOutcome(outcome),
    };
  }

  private async recordAudit(input: {
    actor: string;
    actorType: AuditActorType;
    action: string;
    entity: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
    ip?: string | null;
    userAgent?: string | null;
  }): Promise<void> {
    if (!this.auditService) return;
    await this.auditService.record(input);
  }

  private delegate(value: unknown): DbDelegate {
    return value as DbDelegate;
  }

  private asPayment(value: unknown): PaymentRecord {
    return value as PaymentRecord;
  }

  private asOrder(value: unknown): OrderRecord {
    return value as OrderRecord;
  }

  private asOrderWithoutQuote(value: unknown): Omit<OrderRecord, 'quote'> {
    return value as Omit<OrderRecord, 'quote'>;
  }
}

export interface CallbackFailureResponse {
  readonly payment: null;
  readonly orderId: null;
  readonly outcome: 'FAILED' | 'UNKNOWN';
  readonly verified: false;
  readonly messageFa: string;
}

function safeCallbackFailure(outcome: 'FAILED' | 'UNKNOWN'): CallbackFailureResponse {
  return {
    payment: null,
    orderId: null,
    outcome,
    verified: false,
    messageFa: messageForOutcome(outcome),
  };
}

function normalizeCallbackFailure(status: string | undefined): PaymentFailureReason {
  if (!status) return 'UNKNOWN_PROVIDER_RESPONSE';
  const normalized = status.trim().toUpperCase();
  if (['CANCEL', 'CANCELLED', 'CANCELED', 'CANCEL_BY_USER', 'NOK'].includes(normalized)) {
    return 'CUSTOMER_CANCELLED';
  }
  return 'UNKNOWN_PROVIDER_RESPONSE';
}

function providerAmountToIrr(amount: bigint, unit: PaymentAmountUnit): bigint {
  if (amount <= 0n) throw new RangeError('Provider amount must be positive');
  if (unit === 'IRR') return amount;
  return amount * 10n;
}

/** -1 never equals a stored (positive) amount, so a bad value reads as a mismatch. */
function safeProviderAmountToIrr(amount: bigint, unit: PaymentAmountUnit): bigint {
  try {
    return providerAmountToIrr(amount, unit);
  } catch {
    return -1n;
  }
}

/** A unique-index violation (Prisma P2002), the only insert error worth retrying. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ((error as { code?: unknown }).code === 'P2002') return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.includes('Unique constraint failed');
}

function decimalToBigInt(value: unknown): bigint | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'object' && value !== null && 'toString' in value
    ? String((value as { toString(): string }).toString())
    : String(value);
  if (!/^\d+$/u.test(text)) return null;
  return BigInt(text);
}

function toPaymentDto(payment: PaymentRecord): PaymentDto {
  return {
    id: payment.id,
    orderId: payment.orderId,
    provider: payment.provider,
    status: payment.status,
    // `IrrString` is a branded transport type: the brand asserts "this decimal
    // string came from an exact integer IRR value". `amountIrr` is a BigInt
    // column, so `toString()` is exact by construction and the assertion holds.
    amountIrr: payment.amountIrr.toString() as PaymentDto['amountIrr'],
    displayAmountToman: payment.displayAmountToman.toString() as PaymentDto['displayAmountToman'],
    providerRefId: payment.providerRefId,
    maskedCard: payment.maskedCard,
    failureReason: payment.failureReason,
    requestedAt: payment.requestedAt?.toISOString() ?? null,
    redirectedAt: payment.redirectedAt?.toISOString() ?? null,
    callbackAt: payment.callbackAt?.toISOString() ?? null,
    verifiedAt: payment.verifiedAt?.toISOString() ?? null,
    createdAt: payment.createdAt.toISOString(),
  };
}

function messageForOutcome(outcome: PaymentOutcome): string {
  switch (outcome) {
    case 'PAID':
    case 'ALREADY_VERIFIED':
      return 'پرداخت با موفقیت تأیید شد.';
    case 'CANCELLED':
      return 'پرداخت توسط شما لغو شد.';
    case 'UNKNOWN':
      return 'وضعیت پرداخت مشخص نیست و برای بررسی ثبت شد.';
    case 'FAILED':
      return 'پرداخت تأیید نشد. اگر مبلغ کسر شده، طی ۷۲ ساعت بازگردانده می‌شود.';
  }
}

function shortHash(value: string): string {
  // A one-way identifier is enough for audit correlation and avoids retaining the
  // provider authority in an audit payload.
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}
