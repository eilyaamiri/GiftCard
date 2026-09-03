import type { FxPair } from '@barat/contracts';

import {
  FxProviderError,
  type FxRateProvider,
  type ProviderHealth,
  type RawFxRate,
} from '../fx-rate-provider.interface';

/**
 * `apiv2` — not the `api.nobitex.ir` the docs and most samples show, which has
 * no DNS record at all and fails as NXDOMAIN rather than as a refused request.
 */
const DEFAULT_BASE_URL = 'https://apiv2.nobitex.ir';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
/** Rejects a mangled order book before it can price an order. USDT/IRR spreads sit well under 1%. */
const DEFAULT_MAX_SPREAD_BPS = 1_000;
/** The canonical rate scale. `RawFxRate` strings carry at most six decimals. */
const RATE_SCALE = 6;
/**
 * `FxRate.source` is a category, not a name: the schema documents it as
 * `API | SCRAPE | MANUAL` and the admin panel translates it for operators. The
 * venue this reading came from is carried by the provider name instead, in the
 * `primary-nobitex` form the schema gives as its example.
 */
const OBSERVATION_SOURCE = 'API';

type Clock = () => Date;

type JsonObject = Record<string, unknown>;

/**
 * The market this adapter reads for each supported pair.
 *
 * USD is priced from Tether rather than a bank rate: it is the reference the
 * Iranian market actually settles at, and it is what an operator pays when
 * funding an international payment.
 *
 * `rls` — not `irt` — is deliberate, and the reason is worse than it looks.
 * Measured against the venue on 2026-09-03, `usdt-irt` returns the *same*
 * numbers as `usdt-rls`: rial values under a toman key. A reader who trusted
 * that key would divide by ten and undercharge every order. Requesting `rls`
 * is the only form whose label and value agree.
 *
 * The unit was confirmed by cross-rate rather than by assumption: BTC quoted
 * at 77,954 USDT and at 172,220,000,000 here implies 2,209,254 per USDT, which
 * matches the direct `usdt-rls` quote and puts USD near 220,000 toman — rial.
 */
const MARKETS: Readonly<Record<FxPair, { readonly src: string; readonly dst: string }>> = {
  USD_IRR: { src: 'usdt', dst: 'rls' },
};

export interface NobitexFxRateProviderOptions {
  readonly name?: string;
  /** Overridable for tests; the public market endpoint needs no credential. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly maxSpreadBps?: number;
  readonly clock?: Clock;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function timeoutValue(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMEOUT_MS) {
    throw new RangeError('FX provider timeout must be a positive safe integer');
  }
  return value;
}

function spreadValue(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_SPREAD_BPS;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new RangeError('FX provider max spread must be an integer from 1 to 10000 bps');
  }
  return value;
}

/**
 * Nobitex quotes prices as decimal strings with ten fraction digits. Parsing
 * through `Number` would round a rial away on a large quote, so the value is
 * carried as a scaled bigint and never becomes a float.
 */
function toScaled(value: unknown, provider: string): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/u.test(value.trim())) {
    throw new FxProviderError(provider, 'INVALID_RESPONSE');
  }
  const [whole = '0', fraction = ''] = value.trim().split('.');
  const scaled =
    BigInt(whole) * 10n ** BigInt(RATE_SCALE) +
    BigInt((fraction + '0'.repeat(RATE_SCALE)).slice(0, RATE_SCALE));
  if (scaled <= 0n) {
    throw new FxProviderError(provider, 'INVALID_RESPONSE');
  }
  return scaled;
}

function fromScaled(scaled: bigint): string {
  const base = 10n ** BigInt(RATE_SCALE);
  const fraction = (scaled % base).toString().padStart(RATE_SCALE, '0').replace(/0+$/u, '');
  const whole = (scaled / base).toString();
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/**
 * Nobitex market-data adapter.
 *
 * `market/stats` is a public endpoint: it takes no API key, so no Nobitex
 * credential is read, stored or transmitted anywhere in this class.
 *
 * Documented rate limit is 1000 requests per 10 minutes, which the aggregator's
 * polling stays far below.
 */
export class NobitexFxRateProvider implements FxRateProvider {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxSpreadBps: number;
  private readonly clock: Clock;
  private lastSuccessAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastErrorCode: string | null = null;
  private consecutiveFailures = 0;

  constructor(options: NobitexFxRateProviderOptions = {}) {
    this.name = options.name ?? 'nobitex';
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = timeoutValue(options.timeoutMs);
    this.maxSpreadBps = spreadValue(options.maxSpreadBps);
    this.clock = options.clock ?? (() => new Date());
  }

  async getHealth(): Promise<ProviderHealth> {
    const checkedAt = this.clock();
    const startedAt = checkedAt.getTime();
    try {
      await this.observe('USD_IRR', checkedAt);
      return {
        provider: this.name,
        isHealthy: true,
        checkedAt,
        lastSuccessAt: this.lastSuccessAt,
        lastErrorAt: this.lastErrorAt,
        lastErrorCode: this.lastErrorCode,
        consecutiveFailures: this.consecutiveFailures,
        latencyMs: Math.max(0, this.clock().getTime() - startedAt),
      };
    } catch (error) {
      const normalized = this.normalizeError(error);
      this.recordFailure(checkedAt, normalized.code);
      return {
        provider: this.name,
        isHealthy: false,
        checkedAt,
        lastSuccessAt: this.lastSuccessAt,
        lastErrorAt: this.lastErrorAt,
        lastErrorCode: normalized.code,
        consecutiveFailures: this.consecutiveFailures,
        latencyMs: Math.max(0, this.clock().getTime() - startedAt),
      };
    }
  }

  async getRate(pair: FxPair): Promise<RawFxRate> {
    const receivedAt = this.clock();
    try {
      const rate = await this.observe(pair, receivedAt);
      this.lastSuccessAt = receivedAt;
      this.lastErrorAt = null;
      this.lastErrorCode = null;
      this.consecutiveFailures = 0;
      return rate;
    } catch (error) {
      const normalized = this.normalizeError(error);
      this.recordFailure(receivedAt, normalized.code);
      throw normalized;
    }
  }

  private async observe(pair: FxPair, receivedAt: Date): Promise<RawFxRate> {
    const market = MARKETS[pair];
    if (!market) {
      throw new FxProviderError(this.name, 'UNSUPPORTED_PAIR');
    }

    const response = await this.request(market);
    if (!response.ok) {
      throw new FxProviderError(this.name, 'HTTP_ERROR');
    }
    const payload: unknown = await response.json();
    return this.parseRate(payload, pair, market, receivedAt);
  }

  private async request(market: { src: string; dst: string }): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/market/stats`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ srcCurrency: market.src, dstCurrency: market.dst }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new FxProviderError(this.name, 'NETWORK_ERROR', { cause: error });
    }
  }

  private parseRate(
    payload: unknown,
    pair: FxPair,
    market: { src: string; dst: string },
    receivedAt: Date,
  ): RawFxRate {
    if (!isObject(payload) || payload.status !== 'ok' || !isObject(payload.stats)) {
      /* A rejected pair also arrives as HTTP 200 with `status: "failed"`. */
      throw new FxProviderError(this.name, 'INVALID_RESPONSE');
    }
    const entry = payload.stats[`${market.src}-${market.dst}`];
    if (!isObject(entry)) {
      throw new FxProviderError(this.name, 'INVALID_RESPONSE');
    }
    if (entry.isClosed === true) {
      /* A halted market's last print is not a price anyone can trade at. */
      throw new FxProviderError(this.name, 'MARKET_CLOSED');
    }

    /*
     * Nobitex's own documentation and its community clients disagree about
     * which of `bestBuy`/`bestSell` is the bid, so neither is trusted to be the
     * higher one. Ordering them makes the mid-rate — the only field pricing
     * consumes — identical either way, and keeps buy <= mid <= sell true.
     */
    const first = toScaled(entry.bestBuy, this.name);
    const second = toScaled(entry.bestSell, this.name);
    const low = first <= second ? first : second;
    const high = first <= second ? second : first;

    const spreadBps = Number(((high - low) * 10_000n) / low);
    if (spreadBps > this.maxSpreadBps) {
      throw new FxProviderError(this.name, 'INVALID_RESPONSE');
    }

    /* Half-up at the last micro-unit; bigint division alone truncates. */
    const mid = (low + high + 1n) / 2n;

    return {
      pair,
      buyRate: fromScaled(low),
      sellRate: fromScaled(high),
      midRate: fromScaled(mid),
      source: OBSERVATION_SOURCE,
      receivedAt: new Date(receivedAt),
      /*
       * The endpoint carries no observation timestamp, so the fetch time is the
       * effective time. That is honest for staleness: it dates the reading, and
       * a stalled feed still ages out through the aggregator's threshold.
       */
      effectiveAt: new Date(receivedAt),
      expiresAt: null,
    };
  }

  private recordFailure(at: Date, code: string): void {
    this.lastErrorAt = new Date(at);
    this.lastErrorCode = code;
    this.consecutiveFailures += 1;
  }

  private normalizeError(error: unknown): FxProviderError {
    if (error instanceof FxProviderError) {
      if (error.provider === this.name) {
        return error;
      }
      return new FxProviderError(this.name, error.code, { cause: error });
    }
    return new FxProviderError(this.name, 'NETWORK_ERROR', { cause: error });
  }
}
