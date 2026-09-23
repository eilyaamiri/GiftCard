import {
  type CrossRateProvider,
  type RawCrossRate,
} from '../cross-rate-provider.interface';
import { FxProviderError } from '../fx-rate-provider.interface';

/**
 * Frankfurter — a free, key-less reference-rate service over central-bank data.
 *
 * It publishes once per business day, so it is a reference rate and not a
 * tradeable one. That is the right kind of number for this job: the leg it
 * answers is "what is a GBP 25 card worth in dollars", which is a valuation, not
 * a trade. The rial leg — the one we actually settle at — stays on the market
 * venue, which is where the spread and the risk buffer are applied.
 *
 * It also lists `IRR`, and that rate is deliberately never used: it is the
 * official rate, roughly an order of magnitude away from the free-market one a
 * customer transacts at. Pricing reads IRR from the market venue only.
 */
const DEFAULT_BASE_URL = 'https://api.frankfurter.dev/v2';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;
/**
 * Frankfurter carries around 170 currencies. The cap is a memory bound on a
 * response we do not control, not a limit anyone is expected to reach.
 */
const MAX_ENTRIES = 1_000;
/** `FxRate.source` is a category — `API | SCRAPE | MANUAL` — not a venue name. */
const OBSERVATION_SOURCE = 'API';

const CURRENCY_PATTERN = /^[A-Z]{3}$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
/**
 * Plain decimal notation only. See `rateString` — an exponent here would mean a
 * magnitude we cannot faithfully render, and a wrong rate is worse than none.
 */
const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/u;

type Clock = () => Date;

type JsonObject = Record<string, unknown>;

export interface FrankfurterCrossRateProviderOptions {
  readonly name?: string;
  /** Overridable for tests; the endpoint is public and needs no credential. */
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
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

/**
 * The rate's digits, recovered from the JSON number the endpoint sends.
 *
 * `RawCrossRate.unitsPerUsd` is a string for the reason `RawFxRate` gives: a
 * float is not a rate. Frankfurter, unlike the market venue, serialises rates as
 * JSON *numbers*, so the value has already been through a double by the time
 * `JSON.parse` hands it over and the only question is whether the original
 * digits survived. They do: `toString` emits the shortest decimal that names
 * that double uniquely, and any decimal of fifteen significant digits or fewer
 * is named by itself. Frankfurter publishes six.
 *
 * What does not survive is magnitude. Below 1e-6 `toString` switches to
 * exponent notation, which every downstream decimal parser here would read
 * wrongly or not at all, so such a value is rejected rather than reinterpreted.
 * No live currency is anywhere near that, and the day one is, a refused quote is
 * the outcome we want.
 */
function rateString(value: unknown, provider: string): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new FxProviderError(provider, 'INVALID_RESPONSE');
  }
  const text = String(value);
  if (!DECIMAL_PATTERN.test(text)) {
    throw new FxProviderError(provider, 'INVALID_RESPONSE');
  }
  return text;
}

/**
 * Frankfurter adapter.
 *
 * One request fills the whole table. The endpoint takes no API key, so no
 * credential is read, stored or transmitted in this class. There is no
 * published SLA and the service answers `503` with `Retry-After` when it is
 * down; the caller treats that as any other failure and keeps serving its last
 * good table until it ages out.
 */
export class FrankfurterCrossRateProvider implements CrossRateProvider {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly clock: Clock;

  constructor(options: FrankfurterCrossRateProviderOptions = {}) {
    this.name = options.name ?? 'frankfurter';
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = timeoutValue(options.timeoutMs);
    this.clock = options.clock ?? (() => new Date());
  }

  async getUsdTable(): Promise<readonly RawCrossRate[]> {
    const receivedAt = this.clock();
    const response = await this.request();
    if (!response.ok) {
      throw new FxProviderError(this.name, 'HTTP_ERROR');
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new FxProviderError(this.name, 'INVALID_RESPONSE', { cause: error });
    }
    return this.parseTable(payload, receivedAt);
  }

  private async request(): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/rates?base=USD`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      /* `AbortSignal.timeout` rejects with a `TimeoutError` DOMException. */
      const code = isTimeout(error) ? 'TIMEOUT' : 'NETWORK_ERROR';
      throw new FxProviderError(this.name, code, { cause: error });
    }
  }

  private parseTable(payload: unknown, receivedAt: Date): readonly RawCrossRate[] {
    if (!Array.isArray(payload) || payload.length === 0 || payload.length > MAX_ENTRIES) {
      throw new FxProviderError(this.name, 'INVALID_RESPONSE');
    }

    const table = new Map<string, RawCrossRate>();
    for (const entry of payload) {
      if (!isObject(entry) || entry.base !== 'USD') {
        throw new FxProviderError(this.name, 'INVALID_RESPONSE');
      }
      const currency = entry.quote;
      if (typeof currency !== 'string' || !CURRENCY_PATTERN.test(currency)) {
        throw new FxProviderError(this.name, 'INVALID_RESPONSE');
      }
      /*
       * Entries are dated per currency and they do disagree — a quiet currency
       * keeps yesterday's print while the rest move to today's. The date is
       * recorded per entry for that reason rather than collapsed into one
       * table-wide "as of" that would be a lie for some rows.
       */
      const publishedOn = entry.date;
      if (typeof publishedOn !== 'string' || !DATE_PATTERN.test(publishedOn)) {
        throw new FxProviderError(this.name, 'INVALID_RESPONSE');
      }
      /* First occurrence wins; a repeated currency is a malformed page, not a
       * correction, and silently taking the later one would hide it. */
      if (table.has(currency)) {
        continue;
      }
      table.set(currency, {
        currency,
        unitsPerUsd: rateString(entry.rate, this.name),
        publishedOn,
        source: OBSERVATION_SOURCE,
        receivedAt: new Date(receivedAt),
      });
    }

    return [...table.values()];
  }
}

function isTimeout(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { readonly name?: unknown }).name === 'TimeoutError'
  );
}
