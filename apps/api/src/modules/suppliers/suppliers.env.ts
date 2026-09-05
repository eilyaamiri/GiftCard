import type { ReloadlyEnvironment } from '@barat/suppliers';

/**
 * Supplier adapter wiring inputs.
 *
 * GAP: `apps/api/src/common/config/env.schema.ts` is frozen (Foundation-owned)
 * and declares none of `RELOADLY_ENABLED`, `RELOADLY_ENVIRONMENT`,
 * `RELOADLY_CLIENT_ID`, `RELOADLY_CLIENT_SECRET`, `RELOADLY_RECIPIENT_EMAIL`,
 * `RELOADLY_SENDER_NAME`, `RELOADLY_TIMEOUT_MS` or `SUPPLIER_PROVIDER_SKU_MAP`.
 * They are read here — in one file, never scattered — so the Foundation agent
 * can lift these eight entries into the validated schema in a single pass.
 *
 * Two of them are secrets. They are read into a value object and handed
 * straight to the adapter's constructor; nothing in this file logs, echoes or
 * re-exports them.
 */

const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export interface ReloadlyEnv {
  readonly enabled: boolean;
  readonly environment: ReloadlyEnvironment;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly recipientEmail: string;
  readonly senderName: string | undefined;
  readonly timeoutMs: number;
}

/** `supplierCode:skuId` -> the identifier that supplier knows the SKU by. */
export type ProviderSkuMap = ReadonlyMap<string, string>;

function read(key: string): string | undefined {
  const value = process.env[key]?.trim();
  return value === '' ? undefined : value;
}

/**
 * A flag that decides whether real money can be spent is never inferred. An
 * unset value is off; anything other than `true`/`false` is a misconfiguration
 * worth refusing to boot over, not a silent default.
 */
function readBoolean(key: string, fallback: boolean): boolean {
  const raw = read(key);
  if (raw === undefined) {
    return fallback;
  }
  if (raw !== 'true' && raw !== 'false') {
    throw new Error(`${key} must be exactly "true" or "false"`);
  }
  return raw === 'true';
}

function readRequired(key: string): string {
  const value = read(key);
  if (value === undefined) {
    throw new Error(`${key} is required when RELOADLY_ENABLED is true`);
  }
  return value;
}

function readTimeoutMs(): number {
  const raw = read('RELOADLY_TIMEOUT_MS');
  if (raw === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_TIMEOUT_MS) {
    throw new Error(`RELOADLY_TIMEOUT_MS must be an integer from 1 to ${MAX_TIMEOUT_MS}`);
  }
  return parsed;
}

function readEnvironment(): ReloadlyEnvironment {
  const raw = read('RELOADLY_ENVIRONMENT') ?? 'production';
  if (raw !== 'production' && raw !== 'sandbox') {
    throw new Error('RELOADLY_ENVIRONMENT must be "production" or "sandbox"');
  }
  return raw;
}

export function readReloadlyEnv(): ReloadlyEnv {
  const enabled = readBoolean('RELOADLY_ENABLED', false);
  if (!enabled) {
    return {
      enabled: false,
      environment: 'production',
      clientId: '',
      clientSecret: '',
      recipientEmail: '',
      senderName: undefined,
      timeoutMs: DEFAULT_TIMEOUT_MS,
    };
  }

  return {
    enabled: true,
    environment: readEnvironment(),
    clientId: readRequired('RELOADLY_CLIENT_ID'),
    clientSecret: readRequired('RELOADLY_CLIENT_SECRET'),
    /*
     * Required rather than defaulted: this address receives every gift card the
     * adapter buys, and guessing it would send live codes to a mailbox nobody
     * owns.
     */
    recipientEmail: readRequired('RELOADLY_RECIPIENT_EMAIL'),
    senderName: read('RELOADLY_SENDER_NAME'),
    timeoutMs: readTimeoutMs(),
  };
}

/**
 * GAP: `SupplierOffer` has no `providerSku` column, so the store falls back to
 * our own SKU id — which no external supplier has ever heard of. Until
 * Foundation adds the column, the translation lives in this one variable:
 *
 *     SUPPLIER_PROVIDER_SKU_MAP="reloadly:seed_sku_01=5:25,reloadly:seed_sku_03=5:100"
 *
 * Entries are `supplierCode:skuId=providerSku`. Both separators are split on
 * first occurrence, so a provider SKU containing `:` — Reloadly's
 * `productId:unitPrice` does — survives intact.
 */
export function readProviderSkuMap(): ProviderSkuMap {
  const raw = read('SUPPLIER_PROVIDER_SKU_MAP');
  if (raw === undefined) {
    return new Map();
  }

  const map = new Map<string, string>();
  for (const entry of raw.split(',')) {
    const trimmedEntry = entry.trim();
    if (trimmedEntry === '') {
      continue;
    }
    const separator = trimmedEntry.indexOf('=');
    const key = separator === -1 ? '' : trimmedEntry.slice(0, separator).trim();
    const value = separator === -1 ? '' : trimmedEntry.slice(separator + 1).trim();
    if (key === '' || value === '' || !key.includes(':')) {
      throw new Error(
        'SUPPLIER_PROVIDER_SKU_MAP entries must look like "supplierCode:skuId=providerSku"',
      );
    }
    if (map.has(key)) {
      /* Two rows for one SKU is a silent choice between two prices. */
      throw new Error(`SUPPLIER_PROVIDER_SKU_MAP maps ${key} more than once`);
    }
    map.set(key, value);
  }
  return map;
}

export function providerSkuKey(supplierCode: string, skuId: string): string {
  return `${supplierCode}:${skuId}`;
}
