import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema';

/* A configuration that boots, so each test varies exactly one thing. */
const BASE = {
  NODE_ENV: 'production',
  API_PUBLIC_URL: 'https://api.example.test',
  WEB_PUBLIC_URL: 'https://example.test',
  ADMIN_PUBLIC_URL: 'https://admin.example.test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_JWT_SECRET: 'x'.repeat(48),
  GIFT_CARD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  /* Production refuses to boot on the mock gateway unless told to, and these
   * tests are about the settings key, not about payments. */
  PAYMENTS_ALLOW_MOCK: 'true',
};

function parse(overrides: Record<string, unknown>) {
  return envSchema.safeParse({ ...BASE, ...overrides });
}

describe('SETTINGS_ENCRYPTION_KEY', () => {
  it('is optional, so an existing deployment keeps booting', () => {
    const result = parse({ SETTINGS_ENCRYPTION_KEY: '' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.SETTINGS_ENCRYPTION_KEY).toBeUndefined();
  });

  it('must be a 32-byte base64 key', () => {
    expect(parse({ SETTINGS_ENCRYPTION_KEY: 'short' }).success).toBe(false);
    expect(parse({ SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64') }).success).toBe(true);
  });

  it('may not reuse the gift-card or bank-details key in production', () => {
    expect(parse({ SETTINGS_ENCRYPTION_KEY: BASE.GIFT_CARD_ENCRYPTION_KEY }).success).toBe(false);

    const bank = Buffer.alloc(32, 2).toString('base64');
    expect(parse({ BANK_DETAILS_ENCRYPTION_KEY: bank, SETTINGS_ENCRYPTION_KEY: bank }).success).toBe(false);
  });
});

describe('BACKUP_SOURCE_DIR', () => {
  it('defaults to where the host backup timer writes', () => {
    const result = parse({});
    expect(result.success && result.data.BACKUP_SOURCE_DIR).toBe('/var/backups/baratpay');
  });
});
