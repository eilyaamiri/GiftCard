import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  CreatePaymentRequest,
  PaymentCallbackQuery,
  PaymentDto,
  VerifyPaymentRequest,
  VerifyPaymentResponse,
} from '@barat/contracts';
import type { PaymentAmountUnit, PaymentFailureReason } from '@barat/contracts';
import type { RialPaymentProvider, VerifyResult } from '@barat/payments';
import { AMIN_ORDER_ID_PATTERN, RIAL_PAYMENT_PROVIDER } from '@barat/payments';

import { DomainErrors } from '../../common/errors/domain.exception';
import { type AuditActorType, AuditService } from '../audit/audit.service';
/* The bridge's token and types only: it is the one way payments may move an
 * order, and the module resolves it, so this file never imports OrdersService. */
import {
  ORDER_PAYMENT_BRIDGE,
  type OrderPaymentBridge,
  type OrdersDatabaseCore,
} from '../orders/orders.tokens';
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
  readonly refund: unknown;
  /** Read-only: the customer's verified mobile for the gateway. Absent in some test doubles. */
  readonly customerIdentity?: unknown;
  $transaction<T>(callback: (transaction: PaymentDatabase) => Promise<T>): Promise<T>;
}

interface DbDelegate {
  findUnique(args: Record<string, unknown>): Promise<unknown>;
  findFirst(args: Record<string, unknown>): Promise<unknown>;
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
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

/** Who is applying a gateway answer: a customer-driven request, or the scanner. */
export type VerificationMode = 'callback' | 'reconciliation';

/**
 * Payment state machine.
 *
 * `FAILED / CANCELLED -> PAID` exists for one case: the gateway verifies, with
 * the exact amount, a payment our row had already closed (an earlier failed
 * verify, a forged "cancel"). The customer paid, so the payment completes and
 * the order is delivered (PAY-2).
 *
 * `-> REFUND_PENDING` from a live or closed row is the second capture of an
 * already-paid order: it is real money that goes to the refund queue, never to
 * fulfillment (PLT-5).
 */
const PAYMENT_TRANSITIONS: Readonly<Record<PaymentStatusName, readonly PaymentStatusName[]>> = {
  CREATED: ['REDIRECTED', 'PENDING', 'FAILED', 'CANCELLED', 'UNKNOWN'],
  REDIRECTED: ['PENDING', 'PAID', 'FAILED', 'CANCELLED', 'UNKNOWN', 'REFUND_PENDING'],
  PENDING: ['PAID', 'FAILED', 'CANCELLED', 'UNKNOWN', 'REFUND_PENDING'],
  PAID: ['REFUND_PENDING'],
  FAILED: ['PENDING', 'PAID', 'REFUND_PENDING'],
  CANCELLED: ['PENDING', 'PAID', 'REFUND_PENDING'],
  UNKNOWN: ['PENDING', 'REFUND_PENDING'],
  REFUND_PENDING: ['REFUNDED'],
  REFUNDED: [],
};

/**
 * Edges only the reconciliation path may take. An UNKNOWN payment is settled
 * by asking the gateway again from the scanner, never by a callback: a browser
 * arriving proves nothing, but the gateway's own record does.
 */
const RECONCILIATION_TRANSITIONS: Readonly<Partial<Record<PaymentStatusName, readonly PaymentStatusName[]>>> = {
  UNKNOWN: ['PAID', 'FAILED'],
};

export const PAYMENT_STATUS_TRANSITIONS = PAYMENT_TRANSITIONS;

/** Order statuses that may still open a payment session (orders' state machine). */
const PAYABLE_ORDER_STATUSES: ReadonlySet<string> = new Set(['AWAITING_PAYMENT', 'PAYMENT_PENDING']);

/** Orders closed before any money moved; a late verified payment reopens them. */
const CLOSED_ORDER_STATUSES: ReadonlySet<string> = new Set(['CANCELLED', 'FAILED']);

/**
 * A gateway session that may still take the customer's money. At most one per
 * order (`Payment.liveOrderKey`), and nothing cancels an order while one exists.
 */
const LIVE_PAYMENT_STATUSES: readonly PaymentStatusName[] = ['CREATED', 'REDIRECTED', 'PENDING'];

/** Local statuses a gateway-verified payment may complete from. */
const SETTLEABLE_PAYMENT_STATUSES: readonly PaymentStatusName[] = [
  'CREATED',
  'REDIRECTED',
  'PENDING',
  'FAILED',
  'CANCELLED',
];

/** Bounded so a long-running process does not grow this cache without limit. */
const REDIRECT_URL_CACHE_LIMIT = 2_000;
const ATTEMPT_WRITE_RETRIES = 5;

/**
 * How long a closed or undecided payment is answered from our own row before
 * the gateway is asked again (PAY-13). A customer refreshing the result page,
 * or a script hammering /verify, costs at most one gateway call per window.
 */
export const VERIFY_COOLDOWN_MS = 30_000;

/** The verification lease (PAY-9): how long it is held and how long to wait for it. */
export const VERIFY_LEASE_TTL_MS = 60_000;
const VERIFY_LEASE_WAIT_MS = 20_000;
const VERIFY_LEASE_POLL_MS = 250;

/**
 * A paid order whose fulfillment was never started (the trigger threw after the
 * payment committed) is repaired once it has been PAID this long without a work
 * item or a top-up record. The delay keeps a repair from racing the detached
 * work the first trigger started.
 */
export const FULFILLMENT_REPAIR_AFTER_MS = 2 * 60_000;

/**
 * A live session older than this is treated as abandoned: the scanner asks the
 * gateway about it, and for a gateway that cannot be asked (Amin, without the
 * identifiers of a browser return) closes it locally instead.
 */
export const ABANDONED_SESSION_AFTER_MS = 20 * 60_000;

/**
 * A retry may replace a session this process cannot send the browser back to
 * only once it is this old. A younger one may have been opened a moment ago by
 * another process, in which case it is the customer's current page.
 */
const SESSION_REPLACE_AFTER_MS = 60_000;

/** The reason recorded when a session is closed because the customer walked away or started over. */
const SESSION_CLOSED_REASON: PaymentFailureReason = 'CUSTOMER_CANCELLED';

/**
 * Check a state transition in one place. `UNKNOWN -> PAID / FAILED` is only
 * open to the reconciliation path.
 */
export function assertPaymentTransition(
  from: PaymentStatusName,
  to: PaymentStatusName,
  context: VerificationMode = 'callback',
): void {
  if (context === 'reconciliation' && RECONCILIATION_TRANSITIONS[from]?.includes(to)) return;
  if (!PAYMENT_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Illegal payment transition ${from} -> ${to}`);
  }
}

function canTransition(from: PaymentStatusName, to: PaymentStatusName, mode: VerificationMode): boolean {
  try {
    assertPaymentTransition(from, to, mode);
    return true;
  } catch {
    return false;
  }
}

type RequestContext = { readonly ip?: string | null; readonly userAgent?: string | null };

type VerifiedResult = Extract<VerifyResult, { outcome: 'VERIFIED' }>;

/** The gateway's verified facts, whether from a fresh verify (100) or a settled one (101). */
interface GatewayConfirmation {
  readonly authority: string;
  readonly providerAmount: bigint;
  readonly providerAmountUnit: PaymentAmountUnit;
  readonly refId: string | null;
  readonly maskedCard: string | null;
  readonly cardHash: string | null;
  readonly providerFeeIrr: bigint | null;
  readonly providerFeeType: string | null;
  readonly providerCode: 100 | 101;
}

/** What one settlement attempt did. */
type SettleOutcome =
  /** The payment is now PAID and the order advanced (or was already PAID by it). */
  | { readonly kind: 'PAID'; readonly payment: PaymentRecord; readonly transitioned: boolean }
  /** A second capture for an order that is already paid or closed: refund queue. */
  | { readonly kind: 'REFUND'; readonly payment: PaymentRecord }
  /** The row moved under us; nothing was written. */
  | { readonly kind: 'STALE'; readonly payment: PaymentRecord }
  /** An order status no payment may complete into; flagged, nothing written. */
  | { readonly kind: 'NOT_PAYABLE'; readonly payment: PaymentRecord; readonly orderStatus: string };

/** Reconciliation issue types this module raises (Prisma enum values). */
type IssueType =
  | 'unknown_payment'
  | 'duplicate_payment'
  | 'amount_mismatch'
  | 'provider_already_verified_mismatch'
  | 'gateway_verified_local_closed'
  | 'paid_not_fulfilled'
  | 'paid_without_work_item';

interface IssueInput {
  readonly type: IssueType;
  /** Stable machine reason. Part of the dedupe key, so a replay finds the open issue. */
  readonly reason: string;
  readonly severity?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  readonly details?: Record<string, string | number | boolean>;
  readonly actualAmountIrr?: bigint;
}

/** Provider-neutral payment orchestration and callback verification. */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly db: PaymentDatabase;
  private readonly fulfillmentTrigger: FulfillmentTrigger;
  private readonly orderBridge: OrderPaymentBridge;
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
    /* Every order status change goes through the order state machine (PAY-5).
     * Required for the same reason as the trigger. */
    @Inject(ORDER_PAYMENT_BRIDGE) orderBridge: OrderPaymentBridge,
  ) {
    this.db = database;
    this.fulfillmentTrigger = fulfillmentTrigger;
    this.orderBridge = orderBridge;
  }

  /** Whether the active gateway commits in a second step (BazaarPay). */
  private get twoPhase(): boolean {
    return this.provider.confirmPayment !== undefined;
  }

  /* ======================================================== create a session */

  /**
   * Reserve the payment before contacting the gateway.
   *
   * At most one live session exists per order (PAY-3): a second request — a
   * second tab, a second device, a double click with a fresh key — gets the
   * session that is already open instead of a second chance to pay.
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

    let reservation: Reservation;
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
      /* Two requests with different keys raced for the order's one live slot
       * (`liveOrderKey`). The loser re-reads and joins the winner's session. */
      if (!isUniqueViolation(error)) throw error;
      reservation = await this.reservePayment(input, customerId);
    }

    if (reservation.kind === 'existing') return this.joinLiveSession(reservation.payment);
    if (reservation.replaced !== undefined) {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_SESSION_REPLACED',
        entity: 'Payment',
        entityId: reservation.replaced.id,
        after: { reason: 'unresumable_session', replacedBy: reservation.payment.id },
      });
    }
    return this.openGatewaySession(reservation.payment, input, callbackUrl);
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

  /**
   * The order already has a live session. Hand it back when we can send the
   * browser there; when we cannot (it is still being opened, or this process
   * does not know its hosted-page URL), say so rather than open a second one.
   */
  private joinLiveSession(payment: PaymentRecord): { payment: PaymentDto; redirectUrl: string; created: boolean } {
    const redirectUrl = payment.providerAuthority === null ? '' : this.redirectUrlFor(payment);
    if (redirectUrl === '') {
      throw DomainErrors.conflict(
        'یک پرداخت برای این سفارش در جریان است. لطفاً همان پرداخت را کامل کنید یا چند دقیقه بعد دوباره تلاش کنید.',
        `Order ${payment.orderId} already has live payment ${payment.id}`,
      );
    }
    return { payment: toPaymentDto(payment), redirectUrl, created: false };
  }

  private async reservePayment(input: CreatePaymentRequest, customerId: string): Promise<Reservation> {
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
       * session. Paying into a CANCELLED/FAILED order takes money the shop no
       * longer expects, and paying into a fulfilled or refunded one takes money
       * for nothing. */
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

      /* An earlier session whose outcome we do not know may have taken the
       * money. Opening another before the gateway has answered is how a
       * customer pays twice. The scanner settles it within minutes. A session
       * that never reached the gateway (no authority) cannot have been paid. */
      const undecided = await paymentTx.findFirst({
        where: { orderId: input.orderId, status: 'UNKNOWN', providerAuthority: { not: null } },
      });
      if (undecided !== null) {
        throw DomainErrors.conflict(
          'نتیجهٔ پرداخت قبلی این سفارش هنوز از بانک دریافت نشده است. لطفاً چند دقیقه بعد دوباره تلاش کنید.',
          `Order ${input.orderId} has undecided payment ${this.asPayment(undecided).id}`,
        );
      }

      let replaced: PaymentRecord | null = null;
      const live = await paymentTx.findFirst({
        where: { orderId: input.orderId, status: { in: [...LIVE_PAYMENT_STATUSES] } },
      });
      if (live !== null) {
        const livePayment = this.asPayment(live);
        if (!(await this.isUnresumable(livePayment, transaction))) {
          return { kind: 'existing' as const, payment: livePayment };
        }
        /* A session nobody can resume must not strand the order: the browser
         * cannot be sent back to it and nothing will ever close it. Close it in
         * the same transaction that opens the replacement, so the order's one
         * live slot is never held by both or by neither. If the customer did pay
         * on the old page, its return still finds the row and is settled (or
         * refunded as a duplicate) like any other late payment. */
        const closed = await paymentTx.updateMany({
          where: { id: livePayment.id, status: { in: [...LIVE_PAYMENT_STATUSES] } },
          data: { status: 'CANCELLED', failureReason: SESSION_CLOSED_REASON, liveOrderKey: null },
        });
        if (closed.count !== 1) {
          /* Another request moved it first; whatever it is now, join that. */
          const current = await paymentTx.findUnique({ where: { id: livePayment.id } });
          return { kind: 'existing' as const, payment: this.asPayment(current ?? live) };
        }
        replaced = livePayment;
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
          /* The order's one live slot. A concurrent second reservation fails
           * here on the unique index, whatever the application checked above. */
          liveOrderKey: orderRecord.id,
          requestedAt: new Date(),
        },
      });
      return {
        kind: 'new' as const,
        payment: this.asPayment(created),
        ...(replaced === null ? {} : { replaced }),
      };
    });
  }

  /**
   * Whether a live session can no longer be resumed or settled by anyone.
   *
   * True only for a gateway that has to be told the browser's return identifiers
   * before it will answer about a payment (Amin), when this process does not
   * know where to send the browser and no identifiers were ever stored: there is
   * then no page to return the customer to and no question the scanner could
   * ask. A session whose return was recorded is not unresumable — it can still
   * be verified from the stored identifiers — and neither is a very young one.
   */
  private async isUnresumable(payment: PaymentRecord, transaction: PaymentDatabase): Promise<boolean> {
    if (!this.needsReturnEvidence(payment)) return false;
    if (payment.providerAuthority === null) return false;
    if (this.redirectUrls.has(payment.id)) return false;
    const createdAt = payment.createdAt instanceof Date ? payment.createdAt.getTime() : 0;
    if (Date.now() - createdAt < SESSION_REPLACE_AFTER_MS) return false;
    return (await this.storedCallbackEvidence(payment, transaction)) === undefined;
  }

  /**
   * Gateways that cannot be asked about a payment from our records alone.
   *
   * Amin's verify takes `ref_num` and `tracking_code`, which only the customer's
   * browser return carries. Without them there is nothing to ask, so nothing
   * here may call it, record an attempt for it or move a payment on its account.
   */
  private needsReturnEvidence(payment: PaymentRecord): boolean {
    return payment.provider === 'amin';
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
        customerMobile: await this.verifiedMobile(reservation.customerId),
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
    /* PAY-5: the order learns a session is open through its own state machine.
     * Best effort — a refusal means the order already moved on, and the payment
     * the customer is about to make is still verified and applied normally. */
    await this.orderBridge.markPaymentPending(payment.orderId, payment.id).catch(() => {
      this.logger.warn(`Order ${payment.orderId} did not move to PAYMENT_PENDING for payment ${payment.id}`);
    });
    return { payment: toPaymentDto(payment), redirectUrl: providerResult.redirectUrl, created: true };
  }

  /* ========================================================= gateway returns */

  /**
   * Process a gateway callback. Query values only select the stored payment;
   * whatever the query says, the outcome comes from a server-to-server verify.
   *
   * That includes `Status=NOK` (PAY-1). Anyone holding the authority — browser
   * history, a Referer header — could otherwise cancel a payment the customer
   * then completes, leaving us with their money and no order.
   */
  async callback(
    query: PaymentCallbackQuery,
    context: RequestContext = {},
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
        await this.repairFulfillmentIfMissing(payment);
        return this.responseForPayment(payment, 'PAID', false);
      }

      const result = await this.verifyIfDue(payment, { force: callbackStatus === 'OK' });
      if (result === null) return this.responseForCurrentState(payment);

      /* The gateway confirms nothing was paid: the customer's own "cancel" now
       * only decides the label. A definite FAILED from the gateway is required;
       * a timeout falls through and parks the payment as UNKNOWN. */
      if (callbackStatus !== 'OK' && result.outcome === 'FAILED') {
        const reason = normalizeCallbackFailure(callbackStatus);
        const target = reason === 'CUSTOMER_CANCELLED' ? 'CANCELLED' : 'FAILED';
        const updated = await this.transitionFailure(payment, reason, target);
        return this.responseForPayment(
          updated,
          updated.status === target ? target : outcomeForStatus(updated.status),
          updated.status !== payment.status,
        );
      }

      return this.applyVerificationResult(payment, result, context, 'callback');
    });
  }

  /**
   * The browser returning from ZarinPal. Verifies exactly like `callback`, then
   * hands the controller our own ids for a redirect to the result page (PAY-8),
   * so no payment detail is ever shown to whoever holds the authority.
   */
  async handleZarinPalReturn(
    query: PaymentCallbackQuery,
    context: RequestContext = {},
  ): Promise<{ readonly paymentId: string | null; readonly orderNumber: string | null }> {
    const response = await this.callback(query, context);
    if (response.payment === null) return { paymentId: null, orderNumber: null };
    return { paymentId: response.payment.id, orderNumber: await this.orderNumber(response.orderId) };
  }

  /** Explicit server-side verification endpoint; request amount is never accepted. */
  async verifyPayment(
    input: VerifyPaymentRequest,
    customerId?: string,
    context: RequestContext = {},
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
      if (payment.status === 'PAID') {
        await this.repairFulfillmentIfMissing(payment);
        return this.responseForPayment(payment, 'PAID', false);
      }

      const result = await this.verifyIfDue(payment);
      if (result === null) return this.responseForCurrentState(payment);
      return this.applyVerificationResult(payment, result, context, 'callback');
    });
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
    context: RequestContext = {},
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
      if (current.status === 'PAID') {
        await this.repairFulfillmentIfMissing(current);
        return;
      }
      /* The browser reaching us proves nothing; ask the gateway. The gateway
       * sent it, so this is never answered from the cooldown. */
      const result = await this.verifyIfDue(current, { force: true });
      if (result !== null) await this.applyVerificationResult(current, result, context, 'callback');
    });
    return { paymentId: payment.id, orderNumber: await this.orderNumber(payment.orderId) };
  }

  /**
   * The customer's browser coming back from Amin's hosted page.
   *
   * Amin returns `order_id`, `ref_num` and `tracking_code` and cannot be asked
   * about a payment without the last two, so they travel to the adapter as
   * evidence. Like every return, nothing here is believed: `order_id` only finds
   * a payment we stored (it is our own unguessable value), `status` is ignored,
   * and the outcome is the gateway's answer to a server-to-server verify against
   * OUR stored amount.
   *
   * One deliberate difference from `handleReturn`: an UNKNOWN answer changes
   * nothing. Anyone holding the `order_id` could otherwise send a made-up
   * `ref_num`, get a refusal back, and push a payment the customer is about to
   * complete into UNKNOWN — a state a later callback may not promote to PAID.
   * The payment simply stays open, and the customer's next return or "check
   * again" asks the gateway with the real identifiers.
   */
  async handleAminReturn(
    query: {
      readonly order_id?: unknown;
      readonly ref_num?: unknown;
      readonly tracking_code?: unknown;
    },
    context: RequestContext = {},
  ): Promise<{ readonly paymentId: string | null; readonly orderNumber: string | null }> {
    const orderId = typeof query.order_id === 'string' ? query.order_id : undefined;
    if (orderId === undefined || !AMIN_ORDER_ID_PATTERN.test(orderId)) {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CALLBACK_INVALID',
        entity: 'Payment',
        entityId: 'unknown',
        after: { reason: 'missing_or_malformed_order_id' },
        ...context,
      });
      return { paymentId: null, orderNumber: null };
    }

    const raw = await this.delegate(this.db.payment).findUnique({
      where: {
        provider_providerAuthority: { provider: this.provider.name, providerAuthority: orderId },
      },
    });
    if (raw === null) {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_CALLBACK_UNKNOWN_AUTHORITY',
        entity: 'Payment',
        entityId: 'unknown',
        after: { reason: 'unknown_authority', authorityHash: shortHash(orderId) },
        ...context,
      });
      return { paymentId: null, orderNumber: null };
    }

    const payment = this.asPayment(raw);
    const evidence = aminEvidence(query.ref_num, query.tracking_code);
    await this.recordAttempt(
      payment.id,
      'CALLBACK',
      evidence === undefined ? 'RETURNED' : AMIN_EVIDENCE_STATUS,
      null,
      context,
      evidence,
    );
    await this.withPaymentLock(payment.id, async () => {
      const current = await this.reload(payment);
      if (current.status === 'PAID') {
        await this.repairFulfillmentIfMissing(current);
        return;
      }
      if (evidence === undefined) return;
      /* The gateway sent the browser, so this is never answered from the cooldown. */
      const result = await this.verifyIfDue(current, { force: true, evidence });
      if (result === null || result.outcome === 'UNKNOWN') return;
      await this.applyVerificationResult(current, result, context, 'callback');
    });
    return { paymentId: payment.id, orderNumber: await this.orderNumber(payment.orderId) };
  }

  /* ============================================================ reconciliation */

  /**
   * Ask the gateway about one payment and apply its answer on the controlled
   * reconciliation path (PAY-6). Used by the scanner for sessions customers
   * abandoned, payments left UNKNOWN, and uncommitted two-phase charges waiting
   * for the gateway to hand the money back.
   *
   * This is the one place an UNKNOWN payment may become PAID or FAILED, and only
   * on the gateway's own record with the exact amount.
   */
  async reconcilePayment(paymentId: string): Promise<{ readonly status: PaymentStatusName; readonly changed: boolean }> {
    return this.withPaymentLock(paymentId, async () => {
      const raw = await this.delegate(this.db.payment).findUnique({ where: { id: paymentId } });
      if (raw === null) throw DomainErrors.notFound('Payment');
      const payment = this.asPayment(raw);

      if (payment.provider !== this.provider.name) {
        /* Another gateway's payment: this process cannot ask about it. */
        return { status: payment.status, changed: false };
      }

      if (payment.status === 'PAID') {
        await this.repairFulfillmentIfMissing(payment);
        return { status: payment.status, changed: false };
      }

      if (payment.status === 'CREATED' && payment.providerAuthority === null) {
        /* The gateway never handed us a session, so the customer was never sent
         * anywhere to pay. Closing it frees the order's live slot. */
        const updated = await this.transitionFailure(payment, 'PROVIDER_NETWORK_ERROR', 'FAILED');
        return { status: updated.status, changed: updated.status !== payment.status };
      }

      const evidence = await this.storedCallbackEvidence(payment);
      if (this.needsReturnEvidence(payment) && evidence === undefined) {
        return this.closeUnaskableSession(payment);
      }

      const result = await this.verifyStoredPayment(payment, evidence);
      const response = await this.applyVerificationResult(payment, result, {}, 'reconciliation');
      const status = response.payment.status as PaymentStatusName;
      return { status, changed: status !== payment.status };
    });
  }

  /**
   * A payment the gateway cannot be asked about because its browser return never
   * reached us (Amin). The scanner would otherwise write an attempt row for it
   * every few minutes for ever and the order would never be released.
   *
   * Nothing is asked and nothing is guessed. Once the session is older than
   * `ABANDONED_SESSION_AFTER_MS` it is closed locally — a live one as
   * CANCELLED, an undecided one as FAILED — which frees the order's live slot
   * and lets the payment window close the order. That is no less safe than
   * leaving it open, because nothing can detect a payment without the
   * identifiers either way; and if the customer did pay and the browser comes
   * back later, the return finds this row and settles it through the late
   * payment path, reopening the order if it was closed meanwhile.
   */
  private async closeUnaskableSession(
    payment: PaymentRecord,
  ): Promise<{ readonly status: PaymentStatusName; readonly changed: boolean }> {
    const unchanged = { status: payment.status, changed: false };
    const live = LIVE_PAYMENT_STATUSES.includes(payment.status);
    if (!live && payment.status !== 'UNKNOWN') return unchanged;
    if (Date.now() - payment.createdAt.getTime() < ABANDONED_SESSION_AFTER_MS) return unchanged;

    const updated = live
      ? await this.transitionFailure(payment, SESSION_CLOSED_REASON, 'CANCELLED')
      : await this.transitionStatus(payment, 'FAILED', 'reconciliation', SESSION_CLOSED_REASON);
    if (updated.status === payment.status) return unchanged;

    await this.recordAudit({
      actor: 'system:payments',
      actorType: 'SYSTEM',
      action: 'PAYMENT_SESSION_ABANDONED',
      entity: 'Payment',
      entityId: payment.id,
      after: { reason: 'no_return_identifiers', from: payment.status, to: updated.status },
    });
    return { status: updated.status, changed: true };
  }

  /**
   * Re-start fulfillment for a PAID order that never got a work item or a
   * top-up record (PAY-7): the trigger threw after the payment committed, and
   * every later callback saw PAID and did nothing. Also finishes a two-phase
   * commit that did not go through the first time.
   *
   * Safe to call repeatedly: the trigger is idempotent per order, and nothing
   * happens until the order has been paid for `FULFILLMENT_REPAIR_AFTER_MS`.
   */
  async repairFulfillmentIfMissing(payment: PaymentRecord, now: Date = new Date()): Promise<boolean> {
    if (payment.status !== 'PAID' || payment.verifiedAt === null) return false;
    if (now.getTime() - payment.verifiedAt.getTime() < FULFILLMENT_REPAIR_AFTER_MS) return false;

    const orphan = await this.delegate(this.db.order).findFirst({
      where: {
        id: payment.orderId,
        status: 'PAID',
        workItems: { none: {} },
        topUpFulfillments: { none: {} },
      },
    });
    if (orphan === null) return false;

    if (this.twoPhase) {
      const committed = await this.delegate(this.db.paymentAttempt).findFirst({
        where: { paymentId: payment.id, action: 'CONFIRM', status: 'OK' },
      });
      if (committed === null && !(await this.confirmWithGateway(payment))) return false;
    }

    try {
      await this.fulfillmentTrigger.onOrderPaid({
        orderId: payment.orderId,
        customerId: payment.customerId,
        payload: { paymentId: payment.id, repaired: true },
      });
    } catch {
      await this.raiseIssue(payment, {
        type: 'paid_without_work_item',
        reason: 'FULFILLMENT_TRIGGER_FAILED',
        severity: 'HIGH',
      });
      return false;
    }
    await this.recordAudit({
      actor: 'system:payments',
      actorType: 'SYSTEM',
      action: 'PAYMENT_FULFILLMENT_REPAIRED',
      entity: 'Payment',
      entityId: payment.id,
      after: { orderId: payment.orderId },
    });
    return true;
  }

  /* ===================================================== verification and apply */

  /**
   * Run one verification of one payment at a time — in this process, and across
   * processes.
   *
   * ZarinPal settles inside `verify` and answers every later verify of the same
   * authority with 101. Two overlapping verifications of one payment used to
   * race: the loser got 101 before the winner had written PAID and parked the
   * payment in UNKNOWN. The in-process queue removes that overlap here; the
   * lease on the payment row (PAY-9) removes it between two API processes,
   * without holding a database connection while the gateway answers.
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
      const lease = await this.acquireLease(paymentId);
      try {
        return await work();
      } finally {
        await this.releaseLease(paymentId, lease).catch(() => {
          /* An unreleased lease expires on its own after VERIFY_LEASE_TTL_MS. */
        });
      }
    } finally {
      release();
      if (this.paymentLocks.get(paymentId) === tail) this.paymentLocks.delete(paymentId);
    }
  }

  private async acquireLease(paymentId: string): Promise<string> {
    const token = randomUUID();
    const deadline = Date.now() + VERIFY_LEASE_WAIT_MS;
    for (;;) {
      const now = new Date();
      const taken = await this.delegate(this.db.payment).updateMany({
        where: {
          id: paymentId,
          OR: [{ verifyLeaseUntil: null }, { verifyLeaseUntil: { lt: now } }],
        },
        data: { verifyLeaseUntil: new Date(now.getTime() + VERIFY_LEASE_TTL_MS), verifyLeaseToken: token },
      });
      if (taken.count === 1) return token;
      if (Date.now() >= deadline) {
        throw DomainErrors.conflict(
          'این پرداخت هم‌اکنون در حال بررسی است. لطفاً چند لحظه بعد دوباره تلاش کنید.',
          `Payment ${paymentId} verification lease is held by another process`,
        );
      }
      await sleep(VERIFY_LEASE_POLL_MS);
    }
  }

  private async releaseLease(paymentId: string, token: string): Promise<void> {
    await this.delegate(this.db.payment).updateMany({
      where: { id: paymentId, verifyLeaseToken: token },
      data: { verifyLeaseUntil: null, verifyLeaseToken: null },
    });
  }

  /** The current row, read inside the payment lock rather than trusting a snapshot. */
  private async reload(payment: PaymentRecord): Promise<PaymentRecord> {
    const current = await this.delegate(this.db.payment).findUnique({ where: { id: payment.id } });
    if (current === null) throw DomainErrors.notFound('Payment');
    return this.asPayment(current);
  }

  /**
   * Ask the gateway, unless this payment was asked about moments ago (PAY-13).
   *
   * A live session is always verified, and so is any payment when the gateway
   * itself sent the browser back saying it is done (`force`): that is the
   * customer returning from paying, and a cancel forged a few seconds earlier
   * must not hide their payment. Otherwise a closed or undecided payment is
   * answered from our row for `VERIFY_COOLDOWN_MS` after the last gateway call.
   * Returns null when skipped.
   */
  private async verifyIfDue(
    payment: PaymentRecord,
    options: { readonly force?: boolean; readonly evidence?: Readonly<Record<string, string>> } = {},
    now: Date = new Date(),
  ): Promise<VerifyResult | null> {
    /* In the refund path our row is the answer; only the scanner asks the
     * gateway about it, to see an uncommitted charge handed back. */
    if (payment.status === 'REFUND_PENDING' || payment.status === 'REFUNDED') return null;
    /* Nothing to ask without the return identifiers (Amin): no gateway call, no
     * attempt row, and above all no state change on the strength of a question
     * that was never put. The browser's return, or a later "check again" once
     * identifiers are stored, is what settles it. */
    const evidence = options.evidence ?? (await this.storedCallbackEvidence(payment));
    if (this.needsReturnEvidence(payment) && evidence === undefined) return null;
    if (options.force !== true && !LIVE_PAYMENT_STATUSES.includes(payment.status)) {
      const last = await this.delegate(this.db.paymentAttempt).findFirst({
        where: { paymentId: payment.id, action: 'VERIFY' },
        orderBy: { createdAt: 'desc' },
      });
      const lastAt = (last as { createdAt?: Date } | null)?.createdAt;
      if (lastAt instanceof Date && now.getTime() - lastAt.getTime() < VERIFY_COOLDOWN_MS) return null;
    }
    return this.verifyStoredPayment(payment, evidence);
  }

  private async verifyStoredPayment(
    payment: PaymentRecord,
    evidence?: Readonly<Record<string, string>>,
  ): Promise<VerifyResult> {
    if (!payment.providerAuthority) {
      return { outcome: 'UNKNOWN', providerCode: null, failureReason: 'INVALID_AUTHORITY' };
    }
    await this.recordAttempt(payment.id, 'VERIFY', 'PENDING', null);
    try {
      const callbackEvidence = evidence ?? (await this.storedCallbackEvidence(payment));
      return await this.provider.verifyPayment({
        authority: payment.providerAuthority,
        amountIrr: payment.amountIrr,
        ...(callbackEvidence === undefined ? {} : { evidence: callbackEvidence }),
      });
    } catch {
      return { outcome: 'UNKNOWN', providerCode: null, failureReason: 'PROVIDER_NETWORK_ERROR' };
    }
  }

  /**
   * The identifiers the gateway last handed the browser for this payment, for a
   * gateway that cannot be asked about a payment without them (Amin). They are
   * kept on the CALLBACK attempt so the customer's later "check again" works
   * after a verify that failed on the network, without the browser having to
   * come back. Only the provider that needs them is ever given any.
   */
  private async storedCallbackEvidence(
    payment: PaymentRecord,
    source: PaymentDatabase = this.db,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    if (!this.needsReturnEvidence(payment)) return undefined;
    const attempt = await this.delegate(source.paymentAttempt).findFirst({
      where: { paymentId: payment.id, action: 'CALLBACK', status: AMIN_EVIDENCE_STATUS },
      orderBy: { createdAt: 'desc' },
    });
    return readEvidence((attempt as { responsePayload?: unknown } | null)?.responsePayload);
  }

  private async applyVerificationResult(
    payment: PaymentRecord,
    result: VerifyResult,
    context: RequestContext,
    mode: VerificationMode,
  ): Promise<VerifyPaymentResponse> {
    if (result.outcome === 'ALREADY_VERIFIED') {
      // Re-read before judging. A concurrent callback for the same authority may
      // have committed PAID between loading this snapshot and the provider
      // answering 101; that is the normal, benign cause of code 101.
      const current = await this.reload(payment);
      if (current.status === 'REFUND_PENDING' || current.status === 'REFUNDED') {
        return this.responseForCurrentState(current);
      }
      const matching =
        current.providerAuthority === result.authority &&
        safeProviderAmountToIrr(result.providerAmount, result.providerAmountUnit) === current.amountIrr;
      if (current.status === 'PAID' && matching) return this.responseForPayment(current, 'ALREADY_VERIFIED', false);

      /* The scanner may settle a payment the gateway already holds as paid, for
       * this authority and this exact amount: a verify that settled and whose
       * answer we lost (a timeout, a crash) looks exactly like this. */
      if (mode === 'reconciliation' && matching) {
        return this.applyConfirmation(current, alreadyVerifiedConfirmation(result), context, mode);
      }

      const updated = await this.markAlreadyVerifiedMismatch(current, result, context);
      return this.responseForPayment(updated, 'UNKNOWN', true);
    }

    if (result.outcome !== 'VERIFIED') {
      return this.applyNegativeResult(payment, result, mode);
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

    return this.applyConfirmation(payment, verifiedConfirmation(result), context, mode);
  }

  /** The gateway says the payment did not go through, or cannot say. */
  private async applyNegativeResult(
    payment: PaymentRecord,
    result: Extract<VerifyResult, { outcome: 'FAILED' | 'UNKNOWN' }>,
    mode: VerificationMode,
  ): Promise<VerifyPaymentResponse> {
    /* A two-phase charge we chose not to commit (PAY-4) is handed back by the
     * gateway on its own. Once the gateway no longer holds it as payable, the
     * money is back with the customer. */
    if (payment.status === 'REFUND_PENDING' && result.outcome === 'FAILED' && this.twoPhase) {
      if (await this.isAutoReturn(payment)) {
        const updated = await this.transitionStatus(payment, 'REFUNDED', mode);
        return this.responseForPayment(updated, 'FAILED', true);
      }
      return this.responseForCurrentState(payment);
    }

    if (payment.status === 'UNKNOWN') {
      if (mode === 'reconciliation' && result.outcome === 'FAILED') {
        const updated = await this.transitionStatus(payment, 'FAILED', mode, result.failureReason);
        return this.responseForPayment(updated, 'FAILED', true);
      }
      return this.responseForPayment(payment, 'UNKNOWN', true);
    }

    const target: PaymentStatusName =
      result.failureReason === 'PROVIDER_TIMEOUT' || result.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED';
    /* The scanner asking about a live session and getting no answer leaves it
     * live for the next pass rather than parking it in UNKNOWN on a blip. */
    if (target === 'UNKNOWN' && mode === 'reconciliation' && LIVE_PAYMENT_STATUSES.includes(payment.status)) {
      return this.responseForCurrentState(payment);
    }
    const updated = await this.transitionFailure(payment, result.failureReason, target);
    return this.responseForPayment(updated, target === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED', true);
  }

  /** The gateway holds this payment as paid, for the exact amount. */
  private async applyConfirmation(
    payment: PaymentRecord,
    confirmation: GatewayConfirmation,
    context: RequestContext,
    mode: VerificationMode,
  ): Promise<VerifyPaymentResponse> {
    if (payment.status === 'PAID') return this.responseForPayment(payment, 'PAID', false);

    if (payment.status === 'UNKNOWN' && mode !== 'reconciliation') {
      /* A callback may not promote UNKNOWN; the scanner will, from the gateway's
       * record, within minutes. Until then the customer is told to wait. */
      await this.raiseIssue(payment, {
        type: 'unknown_payment',
        reason: 'UNKNOWN_PAYMENT_STATE',
        details: { providerCode: confirmation.providerCode },
      });
      return this.responseForPayment(payment, 'UNKNOWN', true);
    }

    if (payment.status === 'REFUND_PENDING' || payment.status === 'REFUNDED') {
      /* Already in the refund path. The gateway still holding the money as paid
       * is exactly why it is there; that is not news. */
      return this.responseForCurrentState(payment);
    }

    if (payment.status === 'FAILED' || payment.status === 'CANCELLED') {
      await this.recordAudit({
        actor: 'system:payments',
        actorType: 'SYSTEM',
        action: 'PAYMENT_VERIFIED_AFTER_LOCAL_CLOSE',
        entity: 'Payment',
        entityId: payment.id,
        before: { status: payment.status },
        after: { providerCode: confirmation.providerCode },
        ...context,
      });
    }

    let settled: SettleOutcome;
    try {
      settled = await this.settle(payment, confirmation, mode);
    } catch (error) {
      /* A concurrent capture took the order's paid slot between our check and
       * our write; the unique index refused this one and the transaction rolled
       * back. Re-run: this time it is classified as the second capture. */
      if (!isUniqueViolation(error)) throw error;
      settled = await this.settle(await this.reload(payment), confirmation, mode);
    }

    switch (settled.kind) {
      case 'STALE': {
        if (settled.payment.status === 'PAID') return this.responseForPayment(settled.payment, 'PAID', false);
        /* The compare-and-set lost to a writer that moved the row somewhere other
         * than PAID while the gateway was answering. Reporting PAID here would
         * tell the customer they paid for an order nobody will fulfil. */
        await this.flagVerifiedButNotCommittable(settled.payment, 'verified_provider_but_local_state_changed', context);
        return this.responseForPayment(settled.payment, 'UNKNOWN', true);
      }
      case 'NOT_PAYABLE': {
        await this.raiseIssue(settled.payment, {
          type: 'gateway_verified_local_closed',
          reason: 'VERIFIED_FOR_UNPAYABLE_ORDER',
          details: { orderStatus: settled.orderStatus, localStatus: settled.payment.status },
        });
        return this.responseForPayment(settled.payment, 'UNKNOWN', true);
      }
      case 'REFUND':
        return this.responseForPayment(settled.payment, 'FAILED', true);
      case 'PAID':
        break;
    }

    if (!settled.transitioned) return this.responseForPayment(settled.payment, 'PAID', false);

    /* A two-phase gateway only finalises the charge when we say so, and it
     * hands the money back on its own if we never do. That call is made here —
     * after PAID is durably written and before fulfillment starts — so the
     * gateway can never hold a committed charge our own database does not know
     * about, nor can we deliver on an uncommitted one that is about to be
     * refunded. If the commit does not go through, the order is NOT started;
     * the scanner retries the commit and then starts it. */
    if (this.twoPhase && confirmation.providerCode === 100) {
      const confirmed = await this.confirmWithGateway(settled.payment);
      if (!confirmed) return this.responseForPayment(settled.payment, 'UNKNOWN', true);
    }

    /* Called AFTER the payment transaction commits, never inside it: a
     * rolled-back payment would otherwise leave an operator holding work for an
     * order that was never paid. `onOrderPaid` is idempotent per order, so a
     * replayed callback still produces exactly one work item. If it throws, the
     * payment stays PAID and `repairFulfillmentIfMissing` starts it later.
     *
     * `payload` carries operator context only — never a code, PIN or token. */
    try {
      await this.fulfillmentTrigger.onOrderPaid({
        orderId: settled.payment.orderId,
        customerId: settled.payment.customerId,
        payload: { paymentId: settled.payment.id },
      });
    } catch {
      this.logger.error(`Fulfillment trigger failed for paid order ${settled.payment.orderId}; left for repair`);
    }
    // `verified` means "this call performed the verification". A replay that
    // found the payment already committed reports false.
    return this.responseForPayment(settled.payment, 'PAID', true);
  }

  /**
   * Commit a gateway-confirmed payment, or route it to the refund queue.
   *
   * One transaction decides, from the order and its other payments, which of
   * these this capture is:
   *   - the order's payment: payment PAID, order PAID through the order state
   *     machine (PAY-5), the order's one paid slot taken (`paidOrderKey`);
   *   - a payment for an order closed underneath it: the same, reopening the
   *     order through its one late-payment edge — unless the gateway is
   *     two-phase, where not committing hands the money back on its own (PAY-4);
   *   - a second capture of an order that is already paid: REFUND_PENDING, a
   *     duplicate_payment issue and, when the money is really held, a Refund
   *     request in the finance queue (PLT-5). Never fulfillment.
   */
  private async settle(
    payment: PaymentRecord,
    confirmation: GatewayConfirmation,
    mode: VerificationMode,
  ): Promise<SettleOutcome> {
    const now = new Date();
    return this.db.$transaction(async (transaction) => {
      const paymentTx = this.delegate(transaction.payment);
      const orderTx = this.delegate(transaction.order);

      const fresh = await paymentTx.findUnique({ where: { id: payment.id } });
      if (fresh === null) throw DomainErrors.notFound('Payment');
      const current = this.asPayment(fresh);
      const settleable =
        SETTLEABLE_PAYMENT_STATUSES.includes(current.status) ||
        (current.status === 'UNKNOWN' && mode === 'reconciliation');
      if (!settleable || current.providerAuthority !== confirmation.authority) {
        return { kind: 'STALE', payment: current };
      }

      const order = await orderTx.findUnique({ where: { id: current.orderId } });
      if (order === null) throw DomainErrors.notFound('Order');
      const orderStatus = this.asOrderWithoutQuote(order).status;

      const otherPaid = await paymentTx.findFirst({
        where: { orderId: current.orderId, status: 'PAID', id: { not: current.id } },
      });

      if (orderStatus === 'DRAFT') {
        return { kind: 'NOT_PAYABLE', payment: current, orderStatus };
      }

      const verifiedFields = {
        providerVerifyCode: confirmation.providerCode,
        ...(confirmation.refId === null ? {} : { providerRefId: confirmation.refId }),
        providerAmount: confirmation.providerAmount.toString(),
        providerAmountUnit: confirmation.providerAmountUnit,
        ...(confirmation.providerFeeIrr === null ? {} : { providerFee: confirmation.providerFeeIrr }),
        ...(confirmation.providerFeeType === null ? {} : { providerFeeType: confirmation.providerFeeType }),
        ...(confirmation.maskedCard === null ? {} : { maskedCard: confirmation.maskedCard }),
        ...(confirmation.cardHash === null ? {} : { cardHash: confirmation.cardHash }),
        failureReason: null,
        liveOrderKey: null,
        verifiedAt: now,
      };

      /* Already paid (by another payment) or past payment altogether: this is
       * a second capture. Closed before payment: reopen, unless not committing
       * returns the money by itself. */
      const isDuplicate =
        otherPaid !== null || (!PAYABLE_ORDER_STATUSES.has(orderStatus) && !CLOSED_ORDER_STATUSES.has(orderStatus));
      const closedAndTwoPhase = CLOSED_ORDER_STATUSES.has(orderStatus) && this.twoPhase;

      if (isDuplicate || closedAndTwoPhase) {
        assertPaymentTransition(current.status, 'REFUND_PENDING', mode);
        const moved = await paymentTx.updateMany({
          where: { id: current.id, status: current.status },
          data: { ...verifiedFields, status: 'REFUND_PENDING' },
        });
        if (moved.count === 0) return { kind: 'STALE', payment: current };
        /* A two-phase charge is never committed here, so the gateway returns it
         * by itself: no one has to send money back. A single-phase charge is
         * settled and held by us until finance returns it. */
        const autoReturn = this.twoPhase && confirmation.providerCode === 100;
        const reason = closedAndTwoPhase && !isDuplicate ? 'PAYMENT_FOR_CLOSED_ORDER' : 'DUPLICATE_PAYMENT_FOR_ORDER';
        await this.createIssueInTransaction(transaction, current, {
          type: 'duplicate_payment',
          reason,
          severity: autoReturn ? 'MEDIUM' : 'HIGH',
          details: {
            orderStatus,
            autoReturn,
            ...(otherPaid === null ? {} : { firstPaymentId: this.asPayment(otherPaid).id }),
          },
        });
        if (!autoReturn) await this.requestRefundInTransaction(transaction, current, reason);
        const updated = await paymentTx.findUnique({ where: { id: current.id } });
        return { kind: 'REFUND', payment: this.asPayment(updated ?? current) };
      }

      assertPaymentTransition(current.status, 'PAID', mode);
      const committed = await paymentTx.updateMany({
        where: {
          id: current.id,
          status: current.status,
          providerAuthority: confirmation.authority,
          amountIrr: current.amountIrr,
        },
        /* `paidOrderKey` is the database's guarantee of one capture per order:
         * a concurrent second commit fails on it and rolls this back. */
        data: { ...verifiedFields, status: 'PAID', paidOrderKey: current.orderId },
      });
      if (committed.count === 0) return { kind: 'STALE', payment: current };

      const bridgeOptions = { db: transaction as unknown as OrdersDatabaseCore };
      if (CLOSED_ORDER_STATUSES.has(orderStatus)) {
        await this.orderBridge.markPaidAfterClosure(current.orderId, current.id, bridgeOptions);
        await this.createIssueInTransaction(transaction, current, {
          type: 'paid_not_fulfilled',
          reason: 'PAYMENT_VERIFIED_FOR_CLOSED_ORDER',
          severity: 'LOW',
          details: { orderStatus, reopened: true },
        });
      } else {
        await this.orderBridge.markPaid(current.orderId, current.id, bridgeOptions);
      }

      const updated = await paymentTx.findUnique({ where: { id: current.id } });
      return { kind: 'PAID', payment: this.asPayment(updated ?? current), transitioned: true };
    });
  }

  /** Whether a REFUND_PENDING payment is an uncommitted two-phase charge (no Refund row). */
  private async isAutoReturn(payment: PaymentRecord): Promise<boolean> {
    const refund = await this.delegate(this.db.refund).findFirst({ where: { paymentId: payment.id } });
    return refund === null;
  }

  private async flagVerifiedButNotCommittable(
    payment: PaymentRecord,
    reason: string,
    context: RequestContext,
  ): Promise<void> {
    await this.raiseIssue(payment, {
      type: 'gateway_verified_local_closed',
      reason,
      details: { localStatus: payment.status, providerCode: 100 },
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
    await this.raiseIssue(payment, {
      type: 'unknown_payment',
      reason: 'GATEWAY_COMMIT_NOT_CONFIRMED',
      details: { providerCode: providerCode ?? 0 },
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

  private async markAlreadyVerifiedMismatch(
    payment: PaymentRecord,
    result: Extract<VerifyResult, { outcome: 'ALREADY_VERIFIED' }>,
    context: RequestContext,
  ): Promise<PaymentRecord> {
    const updated = await this.db.$transaction(async (transaction) => {
      const paymentTx = this.delegate(transaction.payment);
      const current = await paymentTx.findUnique({ where: { id: payment.id } });
      if (current === null) throw DomainErrors.notFound('Payment');
      const currentPayment = this.asPayment(current);
      if (currentPayment.status === 'PAID') return currentPayment;
      const changed = await paymentTx.updateMany({
        where: { id: payment.id, status: { in: ['CREATED', 'REDIRECTED', 'PENDING', 'FAILED', 'CANCELLED', 'UNKNOWN'] } },
        data: {
          status: 'UNKNOWN',
          providerVerifyCode: 101,
          failureReason: 'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH',
          liveOrderKey: null,
        },
      });
      if (changed.count === 0) return currentPayment;
      await this.createIssueInTransaction(transaction, payment, {
        type: 'provider_already_verified_mismatch',
        reason: 'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH',
        details: { providerCode: result.providerCode },
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
    await this.raiseIssue(payment, {
      type: 'amount_mismatch',
      reason: 'AMOUNT_MISMATCH',
      severity: 'CRITICAL',
      ...(actualAmountIrr >= 0n ? { actualAmountIrr } : {}),
      details: {
        expectedAmountIrr: payment.amountIrr.toString(),
        actualAmountIrr: actualAmountIrr.toString(),
      },
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
    return this.writeStatus(payment, target, { failureReason: reason });
  }

  /** A transition the caller has decided on, checked against the map for `mode`. */
  private async transitionStatus(
    payment: PaymentRecord,
    target: PaymentStatusName,
    mode: VerificationMode,
    failureReason?: PaymentFailureReason,
  ): Promise<PaymentRecord> {
    if (payment.status === target || !canTransition(payment.status, target, mode)) return payment;
    return this.writeStatus(payment, target, failureReason === undefined ? {} : { failureReason });
  }

  /**
   * Compare-and-set a status. Leaving the live statuses always frees the
   * order's live slot in the same write, so `liveOrderKey` never outlives the
   * session it guards.
   */
  private async writeStatus(
    payment: PaymentRecord,
    target: PaymentStatusName,
    data: Record<string, unknown>,
  ): Promise<PaymentRecord> {
    await this.delegate(this.db.payment).updateMany({
      where: { id: payment.id, status: payment.status },
      data: {
        ...data,
        status: target,
        ...(LIVE_PAYMENT_STATUSES.includes(target) ? {} : { liveOrderKey: null }),
      },
    });
    /* Whether this write or a concurrent one moved the row, the caller gets
     * the row as it now is. */
    return this.reload(payment);
  }

  private async recordCreateFailure(
    payment: PaymentRecord,
    status: 'FAILED' | 'UNKNOWN',
    reason: PaymentFailureReason,
    providerCode: number | null,
  ): Promise<PaymentRecord> {
    if (payment.status !== 'CREATED') return this.reload(payment);
    return this.writeStatus(payment, status, { failureReason: reason, providerRequestCode: providerCode });
  }

  private async recordRedirect(
    payment: PaymentRecord,
    result: Extract<Awaited<ReturnType<RialPaymentProvider['createPayment']>>, { ok: true }>,
  ): Promise<PaymentRecord> {
    assertPaymentTransition(payment.status, 'REDIRECTED');
    await this.delegate(this.db.payment).updateMany({
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
    return this.reload(payment);
  }

  private async recordAttempt(
    paymentId: string,
    action: string,
    status: string,
    providerCode: number | null,
    context: RequestContext = {},
    responsePayload?: Readonly<Record<string, string>>,
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
            ...(responsePayload === undefined ? {} : { responsePayload }),
          },
        });
        return;
      } catch (error) {
        if (attempt >= ATTEMPT_WRITE_RETRIES || !isUniqueViolation(error)) throw error;
      }
    }
  }

  /** Open a reconciliation issue in its own transaction; a replay finds the open one (PAY-11). */
  private async raiseIssue(payment: PaymentRecord, issue: IssueInput): Promise<void> {
    try {
      await this.db.$transaction(async (transaction) => {
        await this.createIssueInTransaction(transaction, payment, issue);
        return undefined;
      });
    } catch (error) {
      /* Two processes raising the same open issue at once: one row is enough. */
      if (!isUniqueViolation(error)) throw error;
    }
  }

  /**
   * One open issue per payment and reason (PAY-11). The key is released when
   * finance resolves the issue, so a recurrence after that opens a new one.
   * Typed by what went wrong (PAY-12), with the amounts filled where known.
   */
  private async createIssueInTransaction(
    transaction: PaymentDatabase,
    payment: PaymentRecord,
    issue: IssueInput,
  ): Promise<void> {
    const issues = this.delegate(transaction.reconciliationIssue);
    const openDedupeKey = `${payment.id}:${issue.reason}`;
    const open = await issues.findUnique({ where: { openDedupeKey } });
    if (open !== null) return;
    await issues.create({
      data: {
        type: issue.type,
        severity: issue.severity ?? 'HIGH',
        paymentId: payment.id,
        orderId: payment.orderId,
        expectedAmountIrr: payment.amountIrr,
        ...(issue.actualAmountIrr === undefined
          ? {}
          : { actualAmountIrr: issue.actualAmountIrr, differenceIrr: issue.actualAmountIrr - payment.amountIrr }),
        details: { reason: issue.reason, ...(issue.details ?? {}) },
        openDedupeKey,
      },
    });
  }

  /** Put a held second capture in the finance refund queue, once per payment. */
  private async requestRefundInTransaction(
    transaction: PaymentDatabase,
    payment: PaymentRecord,
    reason: string,
  ): Promise<void> {
    const refunds = this.delegate(transaction.refund);
    const existing = await refunds.findFirst({ where: { paymentId: payment.id } });
    if (existing !== null) return;
    await refunds.create({
      data: {
        orderId: payment.orderId,
        paymentId: payment.id,
        amountIrr: payment.amountIrr,
        reason,
        status: 'REQUESTED',
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
    /* BazaarPay's and Amin's hosted pages are addressed by a token only the
     * adapter knows (BazaarPay also carries our return URL), so neither can be
     * rebuilt here. A replayed request in a process that has since restarted
     * returns no destination and the customer is sent to the result page, which
     * asks the gateway for the real state. */
    return '';
  }

  /** The answer for a payment we did not (re)verify just now. */
  private responseForCurrentState(payment: PaymentRecord): VerifyPaymentResponse {
    return this.responseForPayment(payment, outcomeForStatus(payment.status), false);
  }

  private responseForPayment(payment: PaymentRecord, outcome: PaymentOutcome, verified: boolean): VerifyPaymentResponse {
    return {
      payment: toPaymentDto(payment),
      orderId: payment.orderId,
      outcome,
      verified,
      messageFa: messageFor(payment, outcome, this.provider.name, this.twoPhase),
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

  /**
   * The customer's OTP-verified mobile, or null. A gateway may use it to sign
   * the customer in on its own page (BazaarPay auto-login does), so a number we
   * have not verified must never reach it: that would open someone else's
   * wallet. A failed lookup only costs the convenience, never the payment.
   */
  private async verifiedMobile(customerId: string): Promise<string | null> {
    if (this.db.customerIdentity === undefined) return null;
    try {
      const identity = await this.delegate(this.db.customerIdentity).findFirst({
        where: { customerId, type: 'MOBILE', isVerified: true },
        orderBy: [{ isPrimary: 'desc' }, { verifiedAt: 'desc' }],
        select: { valueNormalized: true },
      });
      const value = (identity as { valueNormalized?: unknown } | null)?.valueNormalized;
      return typeof value === 'string' && value !== '' ? value : null;
    } catch {
      return null;
    }
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

type Reservation =
  | { readonly kind: 'new'; readonly payment: PaymentRecord; readonly replaced?: PaymentRecord }
  | { readonly kind: 'existing'; readonly payment: PaymentRecord; readonly replaced?: undefined };

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
    messageFa: outcome === 'FAILED' ? 'پرداختی با این مشخصات پیدا نشد.' : 'اطلاعات بازگشت از درگاه ناقص است.',
  };
}

function verifiedConfirmation(result: VerifiedResult): GatewayConfirmation {
  return {
    authority: result.authority,
    providerAmount: result.providerAmount,
    providerAmountUnit: result.providerAmountUnit,
    refId: result.refId,
    maskedCard: result.maskedCard,
    cardHash: result.cardHash,
    providerFeeIrr: result.providerFeeIrr,
    providerFeeType: result.providerFeeType,
    providerCode: 100,
  };
}

function alreadyVerifiedConfirmation(result: Extract<VerifyResult, { outcome: 'ALREADY_VERIFIED' }>): GatewayConfirmation {
  return {
    authority: result.authority,
    providerAmount: result.providerAmount,
    providerAmountUnit: result.providerAmountUnit,
    refId: null,
    maskedCard: null,
    cardHash: null,
    providerFeeIrr: null,
    providerFeeType: null,
    providerCode: 101,
  };
}

function outcomeForStatus(status: PaymentStatusName): PaymentOutcome {
  switch (status) {
    case 'PAID':
      return 'PAID';
    case 'FAILED':
    case 'REFUND_PENDING':
    case 'REFUNDED':
      return 'FAILED';
    case 'CANCELLED':
      return 'CANCELLED';
    default:
      return 'UNKNOWN';
  }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

/**
 * The sentence on the payment result page (PAY-10).
 *
 * It promises only what is true for this gateway and this state. "Returned
 * within 72 hours" is the bank's own reversal of a payment that was never
 * settled; it is NOT true once a single-phase gateway has settled the money,
 * which is what an amount mismatch or a second capture means.
 */
function messageFor(
  payment: PaymentRecord,
  outcome: PaymentOutcome,
  providerName: string,
  twoPhase: boolean,
): string {
  if (payment.status === 'REFUND_PENDING' || payment.status === 'REFUNDED') {
    if (payment.status === 'REFUNDED') return 'مبلغ این پرداخت به شما بازگردانده شده است.';
    return twoPhase
      ? 'این پرداخت نهایی نشد و مبلغ آن به‌طور خودکار به کیف پول شما بازمی‌گردد.'
      : 'این سفارش پیش‌تر پرداخت شده بود. مبلغ این پرداخت برای بازگشت ثبت شد و پس از تأیید واحد مالی به حساب شما بازگردانده می‌شود.';
  }
  switch (outcome) {
    case 'PAID':
    case 'ALREADY_VERIFIED':
      return 'پرداخت با موفقیت تأیید شد.';
    case 'CANCELLED':
      return 'پرداخت توسط شما لغو شد.';
    case 'UNKNOWN':
      return 'نتیجهٔ پرداخت هنوز از بانک دریافت نشده و به‌طور خودکار پیگیری می‌شود. لطفاً دوباره پرداخت نکنید.';
    case 'FAILED':
      if (payment.failureReason === 'AMOUNT_MISMATCH') {
        return 'مبلغ تأییدشده با مبلغ سفارش یکسان نبود و سفارش متوقف شد. پرداخت برای بررسی و بازگشت وجه به واحد مالی ارجاع شد.';
      }
      if (twoPhase || providerName === 'bazaarpay') {
        return 'پرداخت تأیید نشد. اگر مبلغی کسر شده، به‌طور خودکار به کیف پول شما بازمی‌گردد.';
      }
      return 'پرداخت تأیید نشد. اگر مبلغی از حساب شما کسر شده، بانک آن را حداکثر ظرف ۷۲ ساعت بازمی‌گرداند.';
  }
}

function shortHash(value: string): string {
  // A one-way identifier is enough for audit correlation and avoids retaining the
  // provider authority in an audit payload.
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

const AMIN_REFERENCE = /^[A-Za-z0-9._-]{1,128}$/u;
/** Status of the CALLBACK attempt that carries Amin's `ref_num` / `tracking_code`. */
const AMIN_EVIDENCE_STATUS = 'EVIDENCE';

/**
 * The two identifiers Amin's verify needs, from an untrusted return query.
 * Anything that is not a plain bounded string is dropped, so a malformed or
 * repeated parameter can neither reach the gateway nor be stored.
 */
function aminEvidence(refNum: unknown, trackingCode: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof refNum !== 'string' || typeof trackingCode !== 'string') return undefined;
  if (!AMIN_REFERENCE.test(refNum) || !AMIN_REFERENCE.test(trackingCode)) return undefined;
  return { ref_num: refNum, tracking_code: trackingCode };
}

/** Evidence as stored on a CALLBACK attempt, re-validated on the way back out. */
function readEvidence(value: unknown): Readonly<Record<string, string>> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const record = value as Record<string, unknown>;
  return aminEvidence(record['ref_num'], record['tracking_code']);
}
