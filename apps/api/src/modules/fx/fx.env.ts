/**
 * FX provider wiring inputs.
 *
 * GAP: `packages/*` and `apps/api/src/common/config/env.schema.ts` are frozen
 * (Foundation-owned) and do not yet declare `FX_PRIMARY_URL`,
 * `FX_SECONDARY_URL`, `FX_PROVIDER_TIMEOUT_MS`, `FX_USE_MOCK_PROVIDERS`,
 * `FX_PRIMARY_VENUE`, `FX_SECONDARY_VENUE`, `FX_NOBITEX_BASE_URL`,
 * `FX_AUTO_REFRESH` or `FX_REFRESH_INTERVAL_SECONDS`.
 * They are read here — in one file, never scattered — so the Foundation agent
 * can lift these nine entries into the validated schema in a single pass and
 * this file then becomes a thin adapter over `AppConfigService`.
 *
 * No secret is read here: the endpoints are plain URLs. Credentials, when a
 * real provider is chosen, belong in the adapter, never in a log line.
 */

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_REFRESH_SECONDS = 10;
const MAX_REFRESH_SECONDS = 3_600;
/** Comfortably inside Nobitex's 1000-requests-per-10-minutes allowance. */
const DEFAULT_REFRESH_SECONDS = 60;

function readUrl(key: string): string | undefined {
  const value = process.env[key]?.trim();
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('unsupported protocol');
    }
  } catch {
    throw new Error(`${key} must be a valid http(s) URL`);
  }
  return value;
}

function readTimeoutMs(): number {
  const raw = process.env['FX_PROVIDER_TIMEOUT_MS']?.trim();
  if (!raw) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`FX_PROVIDER_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }
  return parsed;
}

function readRefreshSeconds(): number {
  const raw = process.env['FX_REFRESH_INTERVAL_SECONDS']?.trim();
  if (!raw) {
    return DEFAULT_REFRESH_SECONDS;
  }
  const parsed = Number(raw);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_REFRESH_SECONDS ||
    parsed > MAX_REFRESH_SECONDS
  ) {
    throw new Error(
      `FX_REFRESH_INTERVAL_SECONDS must be an integer from ${MIN_REFRESH_SECONDS} to ${MAX_REFRESH_SECONDS}`,
    );
  }
  return parsed;
}

/**
 * Polling is on unless it is switched off explicitly.
 *
 * The safe default is the automatic one: a deployment that forgets this
 * variable gets a rate that tracks the market, not one frozen at whatever the
 * last quote happened to observe.
 */
function readAutoRefresh(): boolean {
  const raw = process.env['FX_AUTO_REFRESH']?.trim().toLowerCase();
  if (!raw) {
    return true;
  }
  if (raw !== 'true' && raw !== 'false') {
    throw new Error('FX_AUTO_REFRESH must be true or false');
  }
  return raw === 'true';
}

/** A named venue adapter, chosen per position instead of a bare endpoint. */
export type FxVenue = 'nobitex';

const VENUES: readonly FxVenue[] = ['nobitex'];

function readVenue(key: string): FxVenue | undefined {
  const value = process.env[key]?.trim().toLowerCase();
  if (!value) {
    return undefined;
  }
  const venue = VENUES.find((candidate) => candidate === value);
  if (!venue) {
    throw new Error(`${key} must be one of: ${VENUES.join(', ')}`);
  }
  return venue;
}

export interface FxProviderEnv {
  readonly primaryUrl: string | undefined;
  readonly secondaryUrl: string | undefined;
  readonly primaryVenue: FxVenue | undefined;
  readonly secondaryVenue: FxVenue | undefined;
  readonly nobitexBaseUrl: string | undefined;
  readonly timeoutMs: number;
  readonly forceMock: boolean;
  readonly autoRefresh: boolean;
  readonly refreshIntervalSeconds: number;
}

export function readFxProviderEnv(): FxProviderEnv {
  return {
    primaryUrl: readUrl('FX_PRIMARY_URL'),
    secondaryUrl: readUrl('FX_SECONDARY_URL'),
    primaryVenue: readVenue('FX_PRIMARY_VENUE'),
    secondaryVenue: readVenue('FX_SECONDARY_VENUE'),
    nobitexBaseUrl: readUrl('FX_NOBITEX_BASE_URL'),
    timeoutMs: readTimeoutMs(),
    forceMock: process.env['FX_USE_MOCK_PROVIDERS']?.trim().toLowerCase() === 'true',
    autoRefresh: readAutoRefresh(),
    refreshIntervalSeconds: readRefreshSeconds(),
  };
}
