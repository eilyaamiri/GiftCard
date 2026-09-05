import { readFileSync } from 'node:fs';

import type { ReloadlyEnvironment } from '@barat/suppliers';

/**
 * Supplier adapter wiring inputs.
 *
 * GAP: `apps/api/src/common/config/env.schema.ts` is frozen (Foundation-owned)
 * and declares none of `RELOADLY_ENABLED`, `RELOADLY_ENVIRONMENT`,
 * `RELOADLY_CLIENT_ID`, `RELOADLY_CLIENT_SECRET`, `RELOADLY_RECIPIENT_EMAIL`,
 * `RELOADLY_SENDER_NAME`, `RELOADLY_TIMEOUT_MS`, `SUPPLIER_PROVIDER_SKU_MAP` or
 * `SUPPLIER_PROVIDER_SKU_MAP_FILE`. They are read here — in one file, never
 * scattered — so the Foundation agent can lift these nine entries into the
 * validated schema in a single pass.
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

/** `supplierCode:skuId` — the shape both sources of the map are keyed by. */
function assertMapKey(key: string, source: string): void {
  if (key === '' || !key.includes(':')) {
    throw new Error(`${source} keys must look like "supplierCode:skuId"`);
  }
}

/**
 * The imported catalog's map: a JSON object of the same keys and values.
 *
 * The inline variable below cannot carry the whole Reloadly catalog — 7,945
 * entries is roughly 320 KB, past what an environment can hold on most systems
 * and unreadable long before that. So the bulk map is generated as a file by
 * `packages/database/prisma/import-reloadly-catalog.ts --map-out=...`, and this
 * points at it:
 *
 *     SUPPLIER_PROVIDER_SKU_MAP_FILE=/opt/baratpay/config/provider-sku-map.json
 *
 * Read once, at boot. A missing or malformed file is a hard failure rather than
 * an empty map: silently forgetting every provider SKU would turn every
 * automatic purchase into an operator task, quietly and at 3am.
 */
function readProviderSkuMapFile(map: Map<string, string>): void {
  const path = read('SUPPLIER_PROVIDER_SKU_MAP_FILE');
  if (path === undefined) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `SUPPLIER_PROVIDER_SKU_MAP_FILE could not be read as JSON: ${(error as Error).message}`,
      { cause: error },
    );
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('SUPPLIER_PROVIDER_SKU_MAP_FILE must contain a JSON object');
  }

  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    assertMapKey(key, 'SUPPLIER_PROVIDER_SKU_MAP_FILE');
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`SUPPLIER_PROVIDER_SKU_MAP_FILE has no provider SKU for ${key}`);
    }
    map.set(key, value.trim());
  }
}

/**
 * GAP: `SupplierOffer` has no `providerSku` column, so the store falls back to
 * our own SKU id — which no external supplier has ever heard of. Until
 * Foundation adds the column, the translation lives in these two variables:
 *
 *     SUPPLIER_PROVIDER_SKU_MAP="reloadly:seed_sku_01=5:25,reloadly:seed_sku_03=5:100"
 *     SUPPLIER_PROVIDER_SKU_MAP_FILE=/opt/baratpay/config/provider-sku-map.json
 *
 * Inline entries are `supplierCode:skuId=providerSku`. Both separators are
 * split on first occurrence, so a provider SKU containing `:` — Reloadly's
 * `productId:unitPrice` does — survives intact.
 *
 * The file is read first and the inline variable second, so a hand-written
 * entry always overrides the generated catalog. That is the direction a person
 * fixing a bad mapping at 3am needs it to go: one line in the env beats a
 * 7,945-entry file, without regenerating anything.
 */
export function readProviderSkuMap(): ProviderSkuMap {
  const map = new Map<string, string>();
  readProviderSkuMapFile(map);

  const raw = read('SUPPLIER_PROVIDER_SKU_MAP');
  if (raw === undefined) {
    return map;
  }

  const inline = new Set<string>();
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
    if (inline.has(key)) {
      /* Two inline rows for one SKU is a silent choice between two prices. */
      throw new Error(`SUPPLIER_PROVIDER_SKU_MAP maps ${key} more than once`);
    }
    inline.add(key);
    map.set(key, value);
  }
  return map;
}

export function providerSkuKey(supplierCode: string, skuId: string): string {
  return `${supplierCode}:${skuId}`;
}
