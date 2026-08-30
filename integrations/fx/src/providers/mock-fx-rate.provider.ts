import type { FxPair } from '@barat/contracts';

import {
  FxProviderError,
  type FxRateProvider,
  type ProviderHealth,
  type RawFxRate,
} from '../fx-rate-provider.interface';

const SCALE = 1_000_000n;
const BPS_DENOMINATOR = 10_000n;
const DEFAULT_BASE_RATE = '1920000';
const DEFAULT_JITTER_SEQUENCE_BPS = [0, 1, -1, 2, -2] as const;

type Clock = () => Date;

export interface MockFxRateProviderOptions {
  /** Mid-market IRR per USD. Defaults to 1,920,000 IRR (192,000 toman). */
  readonly baseRate?: string;
  /** Repeated in order on successive calls, making changing rates reproducible. */
  readonly jitterSequenceBps?: readonly number[];
  readonly buySellHalfSpreadBps?: number;
  readonly healthy?: boolean;
  readonly stale?: boolean;
  readonly staleAgeSeconds?: number;
  readonly clock?: Clock;
  readonly name?: string;
  readonly source?: string;
}

function assertInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${name} must be a safe integer`);
  }
}

function parseRate(value: string): bigint {
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) {
    throw new TypeError('Mock FX rates must be non-negative decimal strings with at most 6 decimals');
  }

  const [integer = '0', fraction = ''] = value.split('.');
  return BigInt(integer) * SCALE + BigInt(fraction.padEnd(6, '0'));
}

function formatRate(value: bigint): string {
  if (value <= 0n) {
    throw new RangeError('Mock FX rates must remain greater than zero');
  }

  const integer = value / SCALE;
  const fraction = (value % SCALE).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction === '' ? integer.toString() : `${integer}.${fraction}`;
}

function applyBps(rate: bigint, bps: number): bigint {
  assertInteger(bps, 'bps');
  return (rate * (BPS_DENOMINATOR + BigInt(bps))) / BPS_DENOMINATOR;
}

/**
 * Deterministic provider for local development and tests. It is never selected
 * implicitly in production; callers must register it explicitly.
 */
export class MockFxRateProvider implements FxRateProvider {
  readonly name: string;

  private readonly baseRate: bigint;
  private readonly jitterSequenceBps: readonly number[];
  private readonly buySellHalfSpreadBps: number;
  private readonly clock: Clock;
  private readonly source: string;
  private healthy: boolean;
  private stale: boolean;
  private staleAgeSeconds: number;
  private callIndex = 0;
  private lastSuccessAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private consecutiveFailures = 0;

  constructor(options: MockFxRateProviderOptions = {}) {
    this.name = options.name ?? 'mock';
    this.source = options.source ?? 'DETERMINISTIC_MOCK';
    this.baseRate = parseRate(options.baseRate ?? DEFAULT_BASE_RATE);
    if (this.baseRate <= 0n) {
      throw new RangeError('Mock baseRate must be greater than zero');
    }

    this.jitterSequenceBps = options.jitterSequenceBps ?? DEFAULT_JITTER_SEQUENCE_BPS;
    if (this.jitterSequenceBps.length === 0) {
      throw new RangeError('jitterSequenceBps must contain at least one entry');
    }
    for (const jitter of this.jitterSequenceBps) {
      assertInteger(jitter, 'jitterSequenceBps entry');
    }

    this.buySellHalfSpreadBps = options.buySellHalfSpreadBps ?? 2;
    assertInteger(this.buySellHalfSpreadBps, 'buySellHalfSpreadBps');
    if (this.buySellHalfSpreadBps < 0) {
      throw new RangeError('buySellHalfSpreadBps cannot be negative');
    }

    this.healthy = options.healthy ?? true;
    this.stale = options.stale ?? false;
    this.staleAgeSeconds = options.staleAgeSeconds ?? 3_600;
    assertInteger(this.staleAgeSeconds, 'staleAgeSeconds');
    if (this.staleAgeSeconds < 0) {
      throw new RangeError('staleAgeSeconds cannot be negative');
    }
    this.clock = options.clock ?? (() => new Date());
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy;
  }

  setStale(stale: boolean, ageSeconds: number = this.staleAgeSeconds): void {
    assertInteger(ageSeconds, 'ageSeconds');
    if (ageSeconds < 0) {
      throw new RangeError('ageSeconds cannot be negative');
    }
    this.stale = stale;
    this.staleAgeSeconds = ageSeconds;
  }

  async getHealth(): Promise<ProviderHealth> {
    const checkedAt = this.clock();
    return {
      provider: this.name,
      isHealthy: this.healthy,
      checkedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorCode: this.healthy ? null : 'FORCED_UNHEALTHY',
      consecutiveFailures: this.consecutiveFailures,
      latencyMs: 0,
    };
  }

  async getRate(pair: FxPair): Promise<RawFxRate> {
    const now = this.clock();
    if (!this.healthy) {
      this.lastErrorAt = now;
      this.consecutiveFailures += 1;
      throw new FxProviderError(this.name, 'NETWORK_ERROR');
    }

    const jitter = this.jitterSequenceBps[this.callIndex % this.jitterSequenceBps.length] ?? 0;
    this.callIndex += 1;

    const mid = applyBps(this.baseRate, jitter);
    const buy = applyBps(mid, this.buySellHalfSpreadBps);
    const sell = applyBps(mid, -this.buySellHalfSpreadBps);
    const effectiveAt = this.stale
      ? new Date(now.getTime() - this.staleAgeSeconds * 1_000)
      : new Date(now);

    this.lastSuccessAt = now;
    this.lastErrorAt = null;
    this.consecutiveFailures = 0;

    return {
      pair,
      buyRate: formatRate(buy),
      sellRate: formatRate(sell),
      midRate: formatRate(mid),
      source: this.source,
      receivedAt: new Date(now),
      effectiveAt,
      expiresAt: null,
    };
  }
}
