import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@barat/contracts';
import { ORDER_STATUS_VALUES, ORDER_TERMINAL_STATUSES } from '@barat/contracts';
import type { Prisma } from '@barat/database';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { deepRedact } from '../audit/deep-redactor';
import type { AuditActorType } from '../audit/audit.service';
import {
  ORDERS_DATABASE,
  type OrdersDatabase,
  type OrdersDatabaseCore,
  type OrderTransitionResult,
} from './orders.tokens';

/* ============================================================================
 * The order state machine
 *
 * There is exactly one place in the system that decides whether an order may
 * move from one status to another, and it is this map. No module writes
 * `order.status` directly and no free-form status string exists anywhere
 * (AGENTS.md rule: financial history is never rewritten, only transitioned).
 *
 * Reading the map:
 *   DRAFT               a shell created from an ACCEPTED quote
 *   AWAITING_PAYMENT    placed; the customer may now open a payment session
 *   PAYMENT_PENDING     a gateway session exists; the outcome is unknown
 *   PAID                a payment was VERIFIED SERVER-SIDE (rule 8)
 *   FULFILLMENT_PENDING queued for an operator or an API supplier
 *   FULFILLING          an operator/supplier is working on it
 *   FULFILLED           the asset reached the customer  (terminal)
 *   FAILED              recoverable-by-staff dead end; refund or cancel
 *   REVIEW_REQUIRED     manual review (cost variance, fraud, KYC)
 *   REFUND_PENDING      a refund was requested
 *   REFUNDED            money returned                  (terminal)
 *   CANCELLED           closed without money movement   (terminal)
 * ==========================================================================*/

export const ALLOWED_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    DRAFT: ['AWAITING_PAYMENT', 'CANCELLED', 'FAILED'],
    AWAITING_PAYMENT: ['PAYMENT_PENDING', 'PAID', 'FAILED', 'CANCELLED'],
    PAYMENT_PENDING: ['PAID', 'FAILED', 'CANCELLED'],
    /* Once PAID is reached every successor remains on a money-moved path. In
     * particular, none can reach CANCELLED: a refund is required instead. */
    PAID: ['FULFILLMENT_PENDING', 'REVIEW_REQUIRED', 'REFUND_PENDING'],
    FULFILLMENT_PENDING: ['FULFILLING', 'REVIEW_REQUIRED', 'REFUND_PENDING'],
    FULFILLING: ['FULFILLED', 'REVIEW_REQUIRED'],
    FULFILLED: [],
    /* FAILED is reserved for the pre-payment path. A fulfillment/refund problem
     * goes to REVIEW_REQUIRED, preserving the fact that money already moved. */
    FAILED: ['CANCELLED'],
    REVIEW_REQUIRED: ['FULFILLMENT_PENDING', 'REFUND_PENDING'],
    REFUND_PENDING: ['REFUNDED', 'REVIEW_REQUIRED'],
    REFUNDED: [],
    CANCELLED: [],
  } satisfies Record<OrderStatus, readonly OrderStatus[]>);

/** Statuses from which nothing further is allowed. Mirrors the contracts list. */
export const TERMINAL_ORDER_STATUSES: ReadonlySet<OrderStatus> = new Set(ORDER_TERMINAL_STATUSES);

/** Every status the machine knows, for exhaustive tests and admin filters. */
export const ORDER_STATUSES: readonly OrderStatus[] = ORDER_STATUS_VALUES;

/** The audit action every status change is recorded under. */
export const ORDER_STATUS_CHANGED = 'ORDER_STATUS_CHANGED';

/** Raised when a caller attempts a transition the map does not contain. */
export class IllegalOrderTransition extends BaratDomainException {
  readonly from: OrderStatus;
  readonly to: OrderStatus;

  constructor(from: OrderStatus, to: OrderStatus) {
    super({
      code: 'CONFLICT',
      status: HttpStatus.CONFLICT,
      safeMessage: 'وضعیت این سفارش اجازهٔ این تغییر را نمی‌دهد.',
      internalDetail: `Illegal order transition ${from} -> ${to}`,
    });
    this.name = 'IllegalOrderTransition';
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function isTerminalOrderStatus(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.has(status);
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalOrderTransition(from, to);
  }
}

/* ============================================================================
 * Applying a transition
 * ==========================================================================*/

/** The minimum an order must expose for the machine to move it. */
export interface OrderStateRecord {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
}

/** Who caused the transition. Recorded verbatim on the audit row. */
export interface OrderActor {
  readonly id: string;
  readonly type: AuditActorType;
  readonly role?: string | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

export interface OrderTransitionOptions {
  /** Run inside an existing interactive transaction instead of the client. */
  readonly db?: OrdersDatabaseCore;
  /** Normalised, customer-safe failure reason. Never a raw provider message. */
  readonly failureReason?: string | null;
  /** Extra audit context, e.g. `{ paymentId }`. Never a secret or a card code. */
  readonly context?: Readonly<Record<string, string>>;
  /** Injected clock, so tests do not depend on wall time. */
  readonly now?: Date;
}

/** Timestamp columns a status implies. Set once, never cleared. */
function timestampsFor(status: OrderStatus, now: Date): Record<string, Date> {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return { placedAt: now };
    case 'PAID':
      return { paidAt: now };
    case 'FULFILLED':
      return { fulfilledAt: now };
    case 'CANCELLED':
      return { cancelledAt: now };
    default:
      return {};
  }
}

/**
 * Executes order status changes and records them.
 *
 * Two guarantees matter here:
 *   1. The update is conditional on the status we read (`where: { id, status }`),
 *      so two concurrent callers cannot both believe they made the transition.
 *   2. An `AuditLog` row is written for every applied transition, which is what
 *      makes the customer-facing order timeline a derived view of the audit
 *      trail rather than a second, divergent source of truth.
 */
@Injectable()
export class OrderStateMachine {
  constructor(@Inject(ORDERS_DATABASE) private readonly database: OrdersDatabase) {}

  /**
   * Move `order` to `next`.
   *
   * Throws `IllegalOrderTransition` when the map does not allow it. Returns
   * `changed: false` when the order is already in the target state, which makes
   * every caller — including a replayed payment callback — idempotent.
   */
  async transition(
    order: OrderStateRecord,
    next: OrderStatus,
    actor: OrderActor,
    reason?: string | null,
    options: OrderTransitionOptions = {},
  ): Promise<OrderTransitionResult> {
    if (order.status === next) {
      return {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: next,
        changed: false,
      };
    }

    assertTransition(order.status, next);

    const now = options.now ?? new Date();
    const apply = async (db: OrdersDatabaseCore): Promise<boolean> => {
      const applied = await db.order.updateMany({
        where: { id: order.id, status: order.status },
        data: {
          status: next,
          ...timestampsFor(next, now),
          ...(options.failureReason === undefined ? {} : { failureReason: options.failureReason }),
        },
      });

      if (applied.count !== 1) {
        /* A concurrent replay of the SAME transition is success: its winning
         * transaction already wrote the one audit row. A different destination
         * is refused; retrying from a stale state could become illegal. */
        const current = await db.order.findUnique({
          where: { id: order.id },
          select: { status: true },
        });
        if (current?.status === next) {
          return false;
        }
        throw new BaratDomainException({
          code: 'CONFLICT',
          status: HttpStatus.CONFLICT,
          safeMessage: 'وضعیت این سفارش هم‌زمان تغییر کرد. لطفاً دوباره تلاش کنید.',
          internalDetail: `Concurrent order status change on ${order.id} (expected ${order.status})`,
        });
      }

      const before = deepRedact({ status: order.status });
      const after = deepRedact({
        status: next,
        reason: reason ?? null,
        ...(options.context ?? {}),
      });
      await db.auditLog.create({
        data: {
          actor: actor.id,
          actorType: actor.type,
          actorRole: actor.role ?? null,
          action: ORDER_STATUS_CHANGED,
          entity: 'Order',
          entityId: order.id,
          before: before as Prisma.InputJsonValue,
          after: after as Prisma.InputJsonValue,
          ip: actor.ip ?? null,
          userAgent: actor.userAgent ?? null,
          requestId: actor.requestId ?? null,
        },
      });
      return true;
    };

    /* The status write and its audit record are one atomic database action. */
    const changed =
      options.db === undefined ? await this.database.$transaction(apply) : await apply(options.db);

    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: next,
      changed,
    };
  }
}
