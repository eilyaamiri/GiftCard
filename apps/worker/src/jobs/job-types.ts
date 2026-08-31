/**
 * Job payload contracts and the handler shape.
 *
 * Every handler is idempotent: BullMQ retries, and a repeatable job may overlap
 * with a manual enqueue, so "ran twice" is the normal case rather than a bug.
 * Idempotency here is structural — each handler works by conditional update
 * (`updateMany` with a status predicate) and reports how many rows it actually
 * changed, so a second run naturally changes nothing.
 */

export interface JobResult {
  /** Rows this run actually changed. A repeat run reports 0. */
  readonly changed: number;
  /** Rows examined and deliberately left alone. */
  readonly skipped: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface QuoteExpiryJobData {
  /** Defaults to now. Overridable so a test can pin the clock. */
  readonly now?: string;
  readonly batchSize?: number;
}

export interface AbandonmentScanJobData {
  readonly now?: string;
  /** Idle minutes after which an OPEN cart counts as abandoned. */
  readonly cartIdleMinutes?: number;
  /** Idle minutes after which an unaccepted quote counts as abandoned. */
  readonly quoteIdleMinutes?: number;
  readonly batchSize?: number;
}

export interface DeliveryRetryJobData {
  readonly now?: string;
  /** Only retry assets whose last attempt is at least this old. */
  readonly minRetryDelayMinutes?: number;
  /** Hard cap on attempts before a human must intervene. */
  readonly maxAttempts?: number;
  readonly batchSize?: number;
}

export interface JobHandler<TData> {
  readonly queueName: string;
  handle(data: TData): Promise<JobResult>;
}
