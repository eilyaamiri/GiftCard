/**
 * Queue names and shared job options.
 *
 * GAP NOTE: `QUEUE_NAMES` and `DEFAULT_JOB_OPTIONS` are also declared in
 * `main.ts`, which is Foundation-owned and which runs `bootstrap()` on import —
 * importing from it would start a worker process inside a unit test. They are
 * mirrored here instead, and `queue-names.spec.ts` asserts the two lists stay
 * identical, so a divergence fails the build rather than silently routing jobs
 * to a queue nobody consumes.
 */

export const QUEUE_NAMES = {
  FX_REFRESH: 'fx-refresh',
  PAYMENT_RECONCILE: 'payment-reconcile',
  DELIVERY_DISPATCH: 'delivery-dispatch',
  QUOTE_EXPIRY: 'quote-expiry',
  ABANDONMENT_SCAN: 'abandonment-scan',
  RECONCILIATION_SWEEP: 'reconciliation-sweep',
  NOTIFICATION_SEND: 'notification-send',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 7 * 24 * 3_600 },
} as const;

/**
 * Repeatable schedules for the sweep queues.
 *
 * A sweep is a safety net, not the primary path: quote expiry is also enforced
 * on read, and abandonment is also derived from funnel events. The schedule only
 * decides how quickly the database catches up with reality.
 */
export const REPEAT_SCHEDULES = {
  [QUEUE_NAMES.QUOTE_EXPIRY]: { every: 60_000 },
  [QUEUE_NAMES.ABANDONMENT_SCAN]: { every: 300_000 },
  [QUEUE_NAMES.DELIVERY_DISPATCH]: { every: 120_000 },
} as const;
