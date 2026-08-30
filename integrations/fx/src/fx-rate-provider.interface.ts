import type { FxPair } from '@barat/contracts';

/**
 * A provider observation. Rates are fixed-point decimal strings in IRR per one
 * unit of the pair's foreign currency. Numbers are deliberately not accepted:
 * converting a JSON number to a rate could silently lose rial precision.
 */
export interface RawFxRate {
  readonly pair: FxPair;
  readonly buyRate: string;
  readonly sellRate: string;
  readonly midRate: string;
  readonly source: string;
  /** When Barat Pay received the response. */
  readonly receivedAt: Date;
  /** When the market observation became effective at the source. */
  readonly effectiveAt: Date;
  /** A provider-supplied hard expiry, when available. */
  readonly expiresAt: Date | null;
  /** Optional credential-free data retained only by an adapter for diagnostics. */
  readonly rawPayload?: Readonly<Record<string, unknown>>;
}

/** Provider liveness. Error codes are normalized and must never contain secrets. */
export interface ProviderHealth {
  readonly provider: string;
  readonly isHealthy: boolean;
  readonly checkedAt: Date;
  readonly lastSuccessAt: Date | null;
  readonly lastErrorAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly consecutiveFailures: number;
  readonly latencyMs?: number;
}

/** The only provider contract consumed by the FX domain module. */
export interface FxRateProvider {
  readonly name: string;
  getRate(pair: FxPair): Promise<RawFxRate>;
  getHealth(): Promise<ProviderHealth>;
}

export type FxProviderErrorCode =
  | 'NOT_CONFIGURED'
  | 'HTTP_ERROR'
  | 'INVALID_RESPONSE'
  | 'NETWORK_ERROR'
  | 'TIMEOUT';

/** Safe, normalized provider failure. It never embeds a URL, body, or credential. */
export class FxProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly code: FxProviderErrorCode,
    options?: { cause?: unknown },
  ) {
    super(`FX provider ${provider} failed with ${code}`, options);
    this.name = 'FxProviderError';
  }
}

/** DI tokens. Primary and secondary are policy positions, not provider names. */
export const FX_PRIMARY_RATE_PROVIDER = 'BARAT_FX_PRIMARY_RATE_PROVIDER';
export const FX_SECONDARY_RATE_PROVIDER = 'BARAT_FX_SECONDARY_RATE_PROVIDER';
