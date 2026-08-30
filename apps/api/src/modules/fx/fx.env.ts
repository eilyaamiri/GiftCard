/**
 * FX provider wiring inputs.
 *
 * GAP: `packages/*` and `apps/api/src/common/config/env.schema.ts` are frozen
 * (Foundation-owned) and do not yet declare `FX_PRIMARY_URL`,
 * `FX_SECONDARY_URL`, `FX_PROVIDER_TIMEOUT_MS` or `FX_USE_MOCK_PROVIDERS`.
 * They are read here — in one file, never scattered — so the Foundation agent
 * can lift these four entries into the validated schema in a single pass and
 * this file then becomes a thin adapter over `AppConfigService`.
 *
 * No secret is read here: the endpoints are plain URLs. Credentials, when a
 * real provider is chosen, belong in the adapter, never in a log line.
 */

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 10_000;

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

export interface FxProviderEnv {
  readonly primaryUrl: string | undefined;
  readonly secondaryUrl: string | undefined;
  readonly timeoutMs: number;
  readonly forceMock: boolean;
}

export function readFxProviderEnv(): FxProviderEnv {
  return {
    primaryUrl: readUrl('FX_PRIMARY_URL'),
    secondaryUrl: readUrl('FX_SECONDARY_URL'),
    timeoutMs: readTimeoutMs(),
    forceMock: process.env['FX_USE_MOCK_PROVIDERS']?.trim().toLowerCase() === 'true',
  };
}
