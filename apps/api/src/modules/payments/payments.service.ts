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
    if (existing !== null) {
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

    const reservation = await this.db.$transaction(async (transaction) => {
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

    let providerResult;
    try {
      providerResult = await this.provider.createPayment({
        amountIrr: reservation.amountIrr,
        orderNumber: await this.orderNumber(input.orderId),
        description: `Barat Pay order ${input.orderId}`,
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
    this.redirectUrls.set(payment.id, providerResult.redirectUrl);
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

    const payment = this.asPayment(paymentRaw);
    await this.recordAttempt(payment.id, 'CALLBACK', callbackStatus === 'OK' ? 'OK' : 'FAILED', null, context);

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

    const payment = this.asPayment(raw);
    if (customerId !== undefined && payment.customerId !== customerId) {
      throw DomainErrors.notFound('Payment');
    }
    if (payment.status === 'PAID') return this.responseForPayment(payment, 'PAID', false);

    const result = await this.verifyStoredPayment(payment);
    return this.applyVerificationResult(payment, result, context);
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
        providerAmountToIrr(result.providerAmount, result.providerAmountUnit) === current.amountIrr;
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

    const committed = await this.commitSuccessfulPayment(payment, result);
    if (committed.transitioned) {
      /* Called AFTER the payment transaction commits, never inside it: a
       * rolled-back payment would otherwise leave an operator holding work for
       * an order that was never paid. `onOrderPaid` is idempotent per order, so
       * a replayed callback still produces exactly one work item.
       *
       * `payload` carries operator context only — never a code, PIN or token. */
      await this.fulfillmentTrigger.onOrderPaid({
        orderId: payment.orderId,
        customerId: payment.customerId,
        payload: { paymentId: payment.id },
      });
    }
    // `verified` means "this call performed the verification". A replay that
    // found the payment already committed reports false.
    return this.responseForPayment(committed.payment, 'PAID', committed.transitioned);
  }

  private async commitSuccessfulPayment(
    payment: PaymentRecord,
    result: Extract<VerifyResult, { outcome: 'VERIFIED' }>,
  ): Promise<{ payment: PaymentRecord; transitioned: boolean }> {
    assertPaymentTransition(payment.status, 'PAID');
    const now = new Date();
    const committed = await this.db.$transaction(async (transaction) => {
      const paymentTx = this.delegate(transaction.payment);
      const orderTx = this.delegate(transaction.order);
      const changed = await paymentTx.updateMany({
        where: {
          id: payment.id,
          status: { in: ['CREATED', 'REDIRECTED', 'PENDING'] },
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
        return { payment: this.asPayment(current), transitioned: false };
      }

      const order = await orderTx.findUnique({ where: { id: payment.orderId } });
      if (order === null) throw DomainErrors.notFound('Order');
      const orderRecord = this.asOrderWithoutQuote(order);
      // The PAID transition is deliberately recorded once. Fulfillment consumes
      // the post-commit event and advances the order to FULFILLMENT_PENDING.
      if (orderRecord.status !== 'PAID' && orderRecord.status !== 'FULFILLMENT_PENDING') {
        await orderTx.update({
          where: { id: payment.orderId },
          data: { status: 'PAID', paidAt: now },
        });
      }
      const updated = await paymentTx.findUnique({ where: { id: payment.id } });
      if (updated === null) throw DomainErrors.notFound('Payment');
      return { payment: this.asPayment(updated), transitioned: true };
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
    assertPaymentTransition(payment.status, target);
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
    const count = await delegate.count({ where: { paymentId } });
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
  ): Promise<void> {
    // The frozen Prisma enum does not yet contain the requested dedicated 101
    // issue value. `unknown_payment` is the safe valid bucket; details retains
    // the exact machine-readable subtype until Foundation adds that enum value.
    await this.delegate(transaction.reconciliationIssue).create({
      data: {
        type: 'unknown_payment',
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
      void this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'AMOUNT_MISMATCH',
        entity: 'Order',
        entityId: order.id,
        before: { quoteAmountIrr: quote.finalAmountIrr.toString(), orderAmountIrr: order.totalAmountIrr.toString() },
      });
      throw DomainErrors.amountMismatch('Quote amount does not equal order total');
    }
  }

  private async orderNumber(orderId: string): Promise<string> {
    const order = await this.delegate(this.db.order).findUnique({ where: { id: orderId } });
    if (order === null) return orderId;
    return this.asOrderWithoutQuote(order).orderNumber;
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
