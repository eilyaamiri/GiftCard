import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildSupplierProviders } from './supplier-providers.factory';
import { providerSkuKey, readProviderSkuMap, readReloadlyEnv } from './suppliers.env';

/*
 * These readers sit in front of real money: one flag decides whether the API is
 * allowed to buy gift cards at all, and one map decides WHICH product it buys.
 * A wrong answer from either is a purchase we cannot take back, so both are
 * tested for what they refuse as much as for what they accept.
 */

const KEYS = [
  'RELOADLY_ENABLED',
  'RELOADLY_ENVIRONMENT',
  'RELOADLY_CLIENT_ID',
  'RELOADLY_CLIENT_SECRET',
  'RELOADLY_RECIPIENT_EMAIL',
  'RELOADLY_SENDER_NAME',
  'RELOADLY_TIMEOUT_MS',
  'SUPPLIER_PROVIDER_SKU_MAP',
  'SUPPLIER_PROVIDER_SKU_MAP_FILE',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  saved.clear();
});

/** The complete set of variables a live Reloadly needs. */
function configureReloadly(): void {
  process.env['RELOADLY_ENABLED'] = 'true';
  process.env['RELOADLY_CLIENT_ID'] = 'client-id';
  process.env['RELOADLY_CLIENT_SECRET'] = 'client-secret';
  process.env['RELOADLY_RECIPIENT_EMAIL'] = 'cards@example.com';
}

describe('readReloadlyEnv', () => {
  it('is off when nothing is configured', () => {
    expect(readReloadlyEnv().enabled).toBe(false);
  });

  it('stays off when credentials are present but the flag is not', () => {
    process.env['RELOADLY_CLIENT_ID'] = 'client-id';
    process.env['RELOADLY_CLIENT_SECRET'] = 'client-secret';
    process.env['RELOADLY_RECIPIENT_EMAIL'] = 'cards@example.com';

    // Deploying the secrets is not the same decision as going live with them.
    expect(readReloadlyEnv().enabled).toBe(false);
  });

  it('refuses a flag it cannot read as a decision', () => {
    for (const raw of ['1', 'yes', 'TRUE', 'on']) {
      process.env['RELOADLY_ENABLED'] = raw;
      expect(() => readReloadlyEnv()).toThrow(/must be exactly/u);
    }
  });

  it('carries no credentials while it is off', () => {
    const env = readReloadlyEnv();

    expect(env.clientId).toBe('');
    expect(env.clientSecret).toBe('');
    expect(env.recipientEmail).toBe('');
  });

  it('reads a complete live configuration', () => {
    configureReloadly();
    process.env['RELOADLY_ENVIRONMENT'] = 'sandbox';
    process.env['RELOADLY_SENDER_NAME'] = 'Barat';
    process.env['RELOADLY_TIMEOUT_MS'] = '5000';

    expect(readReloadlyEnv()).toEqual({
      enabled: true,
      environment: 'sandbox',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      recipientEmail: 'cards@example.com',
      senderName: 'Barat',
      timeoutMs: 5000,
    });
  });

  it('defaults to the production environment', () => {
    configureReloadly();

    expect(readReloadlyEnv().environment).toBe('production');
  });

  it.each(['RELOADLY_CLIENT_ID', 'RELOADLY_CLIENT_SECRET', 'RELOADLY_RECIPIENT_EMAIL'])(
    'refuses to go live without %s',
    (missing) => {
      configureReloadly();
      delete process.env[missing];

      expect(() => readReloadlyEnv()).toThrow(missing);
    },
  );

  it('treats a blank value as missing', () => {
    configureReloadly();
    process.env['RELOADLY_RECIPIENT_EMAIL'] = '   ';

    expect(() => readReloadlyEnv()).toThrow('RELOADLY_RECIPIENT_EMAIL');
  });

  it('rejects an unknown environment rather than guessing', () => {
    configureReloadly();
    process.env['RELOADLY_ENVIRONMENT'] = 'staging';

    expect(() => readReloadlyEnv()).toThrow(/production/u);
  });

  it.each(['0', '-1', '90000', '1.5', 'soon'])('rejects the timeout %s', (raw) => {
    configureReloadly();
    process.env['RELOADLY_TIMEOUT_MS'] = raw;

    expect(() => readReloadlyEnv()).toThrow(/RELOADLY_TIMEOUT_MS/u);
  });
});

describe('readProviderSkuMap', () => {
  it('is empty when unset', () => {
    expect(readProviderSkuMap().size).toBe(0);
  });

  it('maps our SKU ids onto provider SKUs', () => {
    process.env['SUPPLIER_PROVIDER_SKU_MAP'] =
      'reloadly:seed_sku_01=5:25, reloadly:seed_sku_03=3943:100';

    const map = readProviderSkuMap();

    expect(map.get(providerSkuKey('reloadly', 'seed_sku_01'))).toBe('5:25');
    // The provider SKU carries its own colon; only the first one is a separator.
    expect(map.get(providerSkuKey('reloadly', 'seed_sku_03'))).toBe('3943:100');
  });

  it('tolerates blank entries and a trailing comma', () => {
    process.env['SUPPLIER_PROVIDER_SKU_MAP'] = ' reloadly:seed_sku_01=5:25 , ,';

    expect(readProviderSkuMap().size).toBe(1);
  });

  it('refuses a second mapping for one SKU', () => {
    process.env['SUPPLIER_PROVIDER_SKU_MAP'] =
      'reloadly:seed_sku_01=5:25,reloadly:seed_sku_01=5:50';

    // Silently keeping one of two prices is how you buy the wrong card.
    expect(() => readProviderSkuMap()).toThrow(/more than once/u);
  });

  it.each(['reloadly:seed_sku_01', 'seed_sku_01=5:25', '=5:25', 'reloadly:seed_sku_01='])(
    'refuses the malformed entry %s',
    (entry) => {
      process.env['SUPPLIER_PROVIDER_SKU_MAP'] = entry;

      expect(() => readProviderSkuMap()).toThrow(/supplierCode:skuId=providerSku/u);
    },
  );
});

/*
 * The imported Reloadly catalog is ~8,000 mappings — too many for an
 * environment variable — so the bulk of the map arrives as a generated file.
 * It feeds the same decision as the inline variable: which product real money
 * buys. The failure that matters here is the quiet one — a map that comes back
 * empty sends every automatic purchase to an operator instead, at whatever hour
 * the deploy happened.
 */
describe('readProviderSkuMap from a file', () => {
  const path = join(tmpdir(), `provider-sku-map-${String(process.pid)}.json`);

  afterEach(() => {
    rmSync(path, { force: true });
  });

  function writeMap(contents: string): void {
    writeFileSync(path, contents, 'utf8');
    process.env['SUPPLIER_PROVIDER_SKU_MAP_FILE'] = path;
  }

  it('reads the generated catalog map', () => {
    writeMap(JSON.stringify({ 'reloadly:rlx_s_21_25': '21:25', 'reloadly:rlx_s_5_50': '5:50' }));

    const map = readProviderSkuMap();

    expect(map.size).toBe(2);
    expect(map.get(providerSkuKey('reloadly', 'rlx_s_21_25'))).toBe('21:25');
  });

  it('lets an inline entry override the file', () => {
    writeMap(JSON.stringify({ 'reloadly:rlx_s_21_25': '21:25' }));
    process.env['SUPPLIER_PROVIDER_SKU_MAP'] = 'reloadly:rlx_s_21_25=13948:25';

    // Correcting one bad mapping must not mean regenerating 8,000 of them.
    expect(readProviderSkuMap().get(providerSkuKey('reloadly', 'rlx_s_21_25'))).toBe('13948:25');
  });

  it('refuses a file it cannot read', () => {
    process.env['SUPPLIER_PROVIDER_SKU_MAP_FILE'] = join(tmpdir(), 'no-such-map.json');

    // Booting with an empty map would look healthy and buy nothing.
    expect(() => readProviderSkuMap()).toThrow(/SUPPLIER_PROVIDER_SKU_MAP_FILE/u);
  });

  it.each(['[]', 'null', '"reloadly:rlx_s_21_25"', 'not json'])(
    'refuses the file contents %s',
    (contents) => {
      writeMap(contents);

      expect(() => readProviderSkuMap()).toThrow(/SUPPLIER_PROVIDER_SKU_MAP_FILE/u);
    },
  );

  it('refuses a key that names no supplier', () => {
    writeMap(JSON.stringify({ rlx_s_21_25: '21:25' }));

    expect(() => readProviderSkuMap()).toThrow(/supplierCode:skuId/u);
  });

  it.each([['', 'blank'], [' ', 'whitespace']])('refuses the %s provider SKU', (value) => {
    writeMap(JSON.stringify({ 'reloadly:rlx_s_21_25': value }));

    expect(() => readProviderSkuMap()).toThrow(/no provider SKU/u);
  });

  it('refuses a provider SKU that is not a string', () => {
    writeMap('{"reloadly:rlx_s_21_25": 2125}');

    expect(() => readProviderSkuMap()).toThrow(/no provider SKU/u);
  });
});

describe('buildSupplierProviders', () => {
  function keysFor(isTest: boolean): readonly string[] {
    return buildSupplierProviders({ isTest }).map((provider) => provider.key);
  }

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers no live supplier by default', () => {
    expect(keysFor(false)).toEqual(['mock']);
  });

  it('registers Reloadly once it is switched on', () => {
    configureReloadly();

    expect(keysFor(false)).toEqual(['mock', 'reloadly']);
  });

  it('never registers Reloadly under NODE_ENV=test', () => {
    configureReloadly();

    // A test run that reached the live venue would spend real money.
    expect(keysFor(true)).toEqual(['mock']);
  });

  it('does not log the credentials it was given', () => {
    configureReloadly();
    const log = vi.mocked(Logger.prototype.log);

    buildSupplierProviders({ isTest: false });

    const logged = log.mock.calls.flat().join(' ');
    expect(logged).not.toContain('client-id');
    expect(logged).not.toContain('client-secret');
    expect(logged).not.toContain('cards@example.com');
  });
});
