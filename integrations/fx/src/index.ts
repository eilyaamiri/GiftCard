/**
 * @barat/fx — the FX provider CONTRACT.
 *
 * Interfaces only. Concrete providers live in `src/providers/` and are never
 * imported by a domain module (AGENTS.md rule 6, enforced by ESLint).
 *
 * Owner of the implementations: workstream B2.
 */

import type { DecimalString, FxPair } from '@barat/contracts';

/** A rate exactly as a provider reported it. Nothing derived, nothing rounded. */
export interface FxProviderRate {
  readonly pair: FxPair;
  /** IRR paid to buy one unit of the foreign currency. */
  readonly buyRate: DecimalString;
  /** IRR received when selling one unit. */
  readonly sellRate: DecimalString;
  /** Midpoint. Providers that publish only one number report it in all three. */
  readonly midRate: DecimalString;
  /** Provider key, e.g. `mock`, `navasan`, `alanchand`. */
  readonly provider: string;
  /** Free-form source label, e.g. `sana`, `market`. */
  readonly source: string;
  /** When the provider says the rate was observed. */
  readonly effectiveAt: Date;
  /** When we received it. `receivedAt - effectiveAt` is the provider's own lag. */
  readonly receivedAt: Date;
  /** Untouched provider body, kept for audit. Must not contain credentials. */
  readonly rawPayload?: Readonly<Record<string, unknown>>;
}

/** Provider liveness, used by the aggregator to pick primary vs secondary. */
export interface FxProviderHealthStatus {
  readonly provider: string;
  readonly healthy: boolean;
  readonly latencyMs?: number;
  /** Safe reason. Never an API key or a full URL with credentials. */
  readonly reason?: string;
  readonly checkedAt: Date;
}

/**
 * A source of exchange rates.
 *
 * Implementations MUST:
 *   - return decimal STRINGS, never `number` (rule 2);
 *   - throw `FxProviderError` rather than return a stale or guessed rate;
 *   - never log or echo their own credentials.
 *
 * Implementations MUST NOT decide whether a rate is fresh enough to use — that
 * is the aggregator's policy, not the provider's.
 */
export interface FxRateProvider {
  /** Stable key, also written into `Quote.fxProvider`. */
  readonly name: string;
  /** Priority order for the aggregator; lower runs first. */
  readonly priority: number;

  fetchRate(pair: FxPair): Promise<FxProviderRate>;
  healthCheck(): Promise<FxProviderHealthStatus>;
}

/** Raised when a provider cannot produce a trustworthy rate. */
export class FxProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'FxProviderError';
  }
}

/** DI token for the ordered list of registered providers. */
export const FX_RATE_PROVIDERS = 'BARAT_FX_RATE_PROVIDERS';
