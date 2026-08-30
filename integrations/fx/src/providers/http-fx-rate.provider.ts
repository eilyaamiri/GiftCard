import type { FxPair } from '@barat/contracts';

import {
  FxProviderError,
  type FxRateProvider,
  type ProviderHealth,
  type RawFxRate,
} from '../fx-rate-provider.interface';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 60_000;

type Clock = () => Date;

type JsonObject = Record<string, unknown>;

export interface HttpFxRateProviderOptions {
  readonly name: string;
  /** A fully configured endpoint. It must return the canonical rate shape. */
  readonly endpoint?: string;
  readonly timeoutMs?: number;
  readonly clock?: Clock;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function dateField(value: unknown, fallback: Date): Date {
  if (typeof value !== 'string') {
    return new Date(fallback);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new FxProviderError('http', 'INVALID_RESPONSE');
  }
  return parsed;
}

function configuredEndpoint(explicit: string | undefined, name: string): string | undefined {
  if (explicit?.trim()) {
    return explicit.trim();
  }

  const envKey = name === 'primary' ? 'FX_PRIMARY_URL' : 'FX_SECONDARY_URL';
  const endpoint = process.env[envKey];
  return endpoint?.trim() || undefined;
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
 * Shared HTTP adapter for the two deliberately provider-neutral placeholders.
 * No vendor endpoint, authentication scheme, response field, or fallback rate
 * is guessed here. A configured endpoint must return Barat Pay's canonical
 * fixed-point response fields.
 */
export class HttpFxRateProvider implements FxRateProvider {
  readonly name: string;

  private readonly endpoint: string | undefined;
  private readonly timeoutMs: number;
  private readonly clock: Clock;
  private lastSuccessAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastErrorCode: string | null = null;
  private consecutiveFailures = 0;

  constructor(options: HttpFxRateProviderOptions) {
    this.name = options.name;
    this.endpoint = configuredEndpoint(options.endpoint, options.name);
    this.timeoutMs = timeoutValue(options.timeoutMs);
    this.clock = options.clock ?? (() => new Date());
  }

  async getHealth(): Promise<ProviderHealth> {
    const checkedAt = this.clock();
    if (!this.endpoint) {
      return {
        provider: this.name,
        isHealthy: false,
        checkedAt,
        lastSuccessAt: this.lastSuccessAt,
        lastErrorAt: this.lastErrorAt,
        lastErrorCode: 'NOT_CONFIGURED',
        consecutiveFailures: this.consecutiveFailures,
      };
    }

    const startedAt = checkedAt.getTime();
    try {
      const response = await this.request();
      if (!response.ok) {
        throw new FxProviderError(this.name, 'HTTP_ERROR');
      }
      const elapsed = Math.max(0, this.clock().getTime() - startedAt);
      return {
        provider: this.name,
        isHealthy: true,
        checkedAt,
        lastSuccessAt: this.lastSuccessAt,
        lastErrorAt: this.lastErrorAt,
        lastErrorCode: this.lastErrorCode,
        consecutiveFailures: this.consecutiveFailures,
        latencyMs: elapsed,
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
    if (!this.endpoint) {
      this.recordFailure(receivedAt, 'NOT_CONFIGURED');
      throw new FxProviderError(this.name, 'NOT_CONFIGURED');
    }

    try {
      const response = await this.request(pair);
      if (!response.ok) {
        throw new FxProviderError(this.name, 'HTTP_ERROR');
      }

      const payload: unknown = await response.json();
      const rate = this.parseRate(payload, pair, receivedAt);
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

  private async request(pair?: FxPair): Promise<Response> {
    const endpoint = this.endpoint;
    if (!endpoint) {
      throw new FxProviderError(this.name, 'NOT_CONFIGURED');
    }

    let url: URL;
    try {
      url = new URL(endpoint);
    } catch (error) {
      throw new FxProviderError(this.name, 'NOT_CONFIGURED', { cause: error });
    }
    if (pair) {
      url.searchParams.set('pair', pair);
    }

    try {
      return await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new FxProviderError(this.name, 'NETWORK_ERROR', { cause: error });
    }
  }

  private parseRate(payload: unknown, pair: FxPair, receivedAt: Date): RawFxRate {
    if (!isObject(payload)) {
      throw new FxProviderError(this.name, 'INVALID_RESPONSE');
    }
    const data = isObject(payload.data) ? payload.data : payload;
    const buyRate = stringField(data.buyRate);
    const sellRate = stringField(data.sellRate);
    const midRate = stringField(data.midRate);
    if (!buyRate || !sellRate || !midRate) {
      throw new FxProviderError(this.name, 'INVALID_RESPONSE');
    }
    if (!isFixedPointDecimal(buyRate) || !isFixedPointDecimal(sellRate) || !isFixedPointDecimal(midRate)) {
      throw new FxProviderError(this.name, 'INVALID_RESPONSE');
    }

    const source = stringField(data.source) ?? 'API';
    const effectiveAt = dateField(data.effectiveAt, receivedAt);
    const expiresAt = data.expiresAt === null || data.expiresAt === undefined
      ? null
      : dateField(data.expiresAt, receivedAt);

    return {
      pair,
      buyRate,
      sellRate,
      midRate,
      source,
      receivedAt: new Date(receivedAt),
      effectiveAt,
      expiresAt,
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

function isFixedPointDecimal(value: string): boolean {
  return /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/u.test(value) && /[1-9]/u.test(value);
}
