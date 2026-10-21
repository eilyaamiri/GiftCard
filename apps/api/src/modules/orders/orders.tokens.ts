import type { OrderStatus } from '@barat/contracts';
import type { PrismaClient } from '@barat/database';

/* ============================================================================
 * Database port
 *
 * The orders module depends on a narrow slice of the Prisma client rather than
 * on the singleton, so a unit test can supply a fake without a database and the
 * module cannot silently reach a table it does not own.
 * ==========================================================================*/

export const ORDERS_DATABASE = Symbol('ORDERS_DATABASE');

/** Delegates reachable both on the client and inside an interactive transaction. */
export type OrdersDatabaseCore = Pick<
  PrismaClient,
  'order' | 'quote' | 'giftCardAsset' | 'auditLog'
>;

export interface OrdersDatabase extends OrdersDatabaseCore {
  $transaction<T>(
    callback: (transaction: OrdersDatabaseCore) => Promise<T>,
    options?: { readonly isolationLevel?: 'Serializable' },
  ): Promise<T>;
}

/* ============================================================================
 * Order <- Payments bridge
 *
 * The payments module must be able to advance an order when a payment is
 * verified server-side, but `orders -> payments -> orders` would be a module
 * cycle. So orders publishes an interface plus an injection token; payments
 * injects the token and never imports `OrdersService`. Payments never writes
 * `order.status` itself.
 *
 * This mirrors `FULFILLMENT_TRIGGER` in the payments module, which fulfillment
 * consumes the same way.
 * ==========================================================================*/

export const ORDER_PAYMENT_BRIDGE = Symbol('ORDER_PAYMENT_BRIDGE');

export interface OrderTransitionResult {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  /**
   * False when the order was already in the target state, i.e. this call was a
   * replay. Callers must treat that as success, not as an error (rule 9).
   */
  readonly changed: boolean;
}

/**
 * How a bridge call is applied.
 *
 * `db` runs the transition inside the caller's interactive transaction, so the
 * payment row and the order row change together or not at all. Without it the
 * bridge opens its own transaction.
 */
export interface OrderBridgeOptions {
  readonly db?: OrdersDatabaseCore;
}

/**
 * The only order operations the payments module is allowed to perform.
 *
 * Every method is idempotent and every state change goes through the order
 * state machine, so a replayed gateway callback can never produce an illegal
 * transition or a second audit trail entry for the same effect.
 */
export interface OrderPaymentBridge {
  /** A payment session was opened: AWAITING_PAYMENT -> PAYMENT_PENDING. */
  markPaymentPending(
    orderId: string,
    paymentId: string,
    options?: OrderBridgeOptions,
  ): Promise<OrderTransitionResult>;

  /** A payment was verified server-side: AWAITING_PAYMENT / PAYMENT_PENDING -> PAID. */
  markPaid(orderId: string, paymentId: string, options?: OrderBridgeOptions): Promise<OrderTransitionResult>;

  /**
   * A payment the gateway verified for an order that was closed (CANCELLED or
   * FAILED) while its outcome was still unknown: -> PAID.
   *
   * The customer paid the quoted amount, so the order is delivered as normal
   * rather than left holding their money. This is the ONLY way out of a closed
   * status, and only the payments module, after a server-side verification with
   * the exact amount, may call it.
   */
  markPaidAfterClosure(
    orderId: string,
    paymentId: string,
    options?: OrderBridgeOptions,
  ): Promise<OrderTransitionResult>;

  /**
   * A payment failed or was cancelled: -> FAILED.
   * `reason` must be one of our normalised reasons, never a raw provider text.
   */
  markPaymentFailed(
    orderId: string,
    paymentId: string,
    reason: string,
  ): Promise<OrderTransitionResult>;
}
