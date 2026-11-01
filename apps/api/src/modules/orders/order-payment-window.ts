import type { OrderStatus } from '@barat/contracts';
import type { PaymentStatus } from '@barat/contracts';

/* ============================================================================
 * The payment window
 *
 * An order that nobody pays for is not free to leave open. It holds a quote's
 * frozen price against a market that has moved on, it sits in the operator's
 * "awaiting payment" list forever, and it lets a customer return days later to
 * a gateway session priced at a rate we no longer offer. Ten minutes after the
 * order is placed the window closes and the order is cancelled.
 *
 * Cancelling moves no money. It is `AWAITING_PAYMENT`/`PAYMENT_PENDING` ->
 * `CANCELLED`, which the order state machine already allows, and it is refused
 * outright from `PAID` onwards — a paid order needs a refund, never a cancel.
 * ==========================================================================*/

/**
 * How long a placed order stays payable.
 *
 * Deliberately a constant rather than configuration: `apps/web` shows the same
 * deadline to the customer and cannot read it from the API, because
 * `OrderDetailDto` is frozen and has nowhere to carry it (see
 * `paymentDeadline`'s note). Two mirrored constants can be kept in step by
 * review; two mirrored environment variables cannot.
 */
export const PAYMENT_WINDOW_MS = 10 * 60_000;

/** Statuses a customer or the sweep may still cancel out of. */
export const CANCELLABLE_ORDER_STATUSES: readonly OrderStatus[] = ['AWAITING_PAYMENT', 'PAYMENT_PENDING'];

/**
 * Payment statuses that mean money may still be in flight at the gateway.
 *
 * Nothing cancels an order while one of these exists: an order whose outcome
 * the gateway has not yet reported is never closed underneath its payment.
 *
 * Such a session does not hold the order open for ever (ORD-10). The payments
 * module's reconciliation scanner asks the gateway about any session older than
 * twenty minutes and closes it on a definite answer, after which this window's
 * sweep cancels the order on its next pass. And should a payment be verified
 * for an order closed regardless, the payments module reopens it through the
 * state machine's one late-payment edge rather than writing the status itself.
 */
export const LIVE_PAYMENT_STATUSES: readonly PaymentStatus[] = ['CREATED', 'REDIRECTED', 'PENDING'];

/**
 * When the window closes for an order placed at `placedAt`.
 *
 * `placedAt` is stamped by the `AWAITING_PAYMENT` transition and is the honest
 * start of the window. It falls back to `createdAt` for the moments between the
 * `DRAFT` insert and that transition, which is at most one request apart.
 */
export function paymentDeadline(order: {
  readonly placedAt: Date | null;
  readonly createdAt: Date;
}): Date {
  const start = order.placedAt ?? order.createdAt;
  return new Date(start.getTime() + PAYMENT_WINDOW_MS);
}

/** Whether the window has closed at `now`. */
export function paymentWindowElapsed(
  order: { readonly placedAt: Date | null; readonly createdAt: Date },
  now: Date,
): boolean {
  return paymentDeadline(order).getTime() <= now.getTime();
}

/** The audit reason recorded when the sweep closes an order. */
export const CANCELLED_BY_TIMEOUT = 'payment window elapsed';

/** The audit reason recorded when the customer closes their own order. */
export const CANCELLED_BY_CUSTOMER = 'cancelled by customer';
