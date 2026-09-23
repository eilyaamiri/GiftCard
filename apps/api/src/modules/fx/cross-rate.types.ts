/** DI tokens and shapes for the USD cross-rate leg. */
export const FX_CROSS_RATE_CONFIG = 'BARAT_FX_CROSS_RATE_CONFIG';

export interface CrossRateConfig {
  /**
   * How long a fetched table is served before another is attempted. It also
   * paces retries after a failure, so a feed that is down is polled at this
   * rate rather than on every quote.
   */
  readonly refreshIntervalSeconds: number;
  /**
   * How old a table may be and still price an order.
   *
   * Measured from when we fetched it, not from the day the source printed it.
   * A reference rate publishes once per business day, so over a weekend the
   * published date is two days old while the rate is still the current one —
   * judging by the print date would refuse every Sunday order for no reason.
   * What this threshold actually guards is our own feed going quiet.
   */
  readonly staleThresholdSeconds: number;
  /** Warm the table at boot. Off under test, where a live timer is a hazard. */
  readonly warmOnStart: boolean;
  /** Overridable for tests. */
  readonly now?: () => Date;
}

/** One currency against the dollar, as the quote engine consumes it. */
export interface CrossRateSnapshot {
  readonly currency: string;
  /** Units of `currency` per one USD, as published. Divide; never invert. */
  readonly unitsPerUsd: string;
  readonly provider: string;
  readonly source: string;
  /** The day the source dated it, or `null` for the dollar itself. */
  readonly publishedOn: string | null;
  readonly receivedAt: string;
  readonly ageSeconds: number;
  readonly isStale: boolean;
  /** True for USD, which is the base and needs no feed to be worth one dollar. */
  readonly isIdentity: boolean;
}

export type CrossRateUnavailableReason =
  /** The feed does not publish this currency. */
  | 'UNSUPPORTED_CURRENCY'
  /** We have never successfully fetched a table. */
  | 'PROVIDER_UNAVAILABLE';

/**
 * A cross rate could not be produced.
 *
 * Deliberately not a `DomainException`: the FX module has no business writing
 * the Persian sentence a customer reads. Quotes catches this and decides what
 * to say, which is where the customer-facing vocabulary already lives.
 */
export class CrossRateUnavailableError extends Error {
  constructor(
    readonly currency: string | null,
    readonly reason: CrossRateUnavailableReason,
  ) {
    super(`Cross rate unavailable for ${currency ?? 'any currency'}: ${reason}`);
    this.name = 'CrossRateUnavailableError';
  }
}
