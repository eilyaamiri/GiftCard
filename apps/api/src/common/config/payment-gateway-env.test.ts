import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema';

/**
 * Which rial gateway takes the money is decided at boot, from the validated
 * environment. These rules make every unsafe combination fail loudly instead
 * of resolving to the mock gateway, which treats every payment as paid.
 */

const BASE = {
  NODE_ENV: 'production',
  API_PUBLIC_URL: 'https://api.example.test',
  WEB_PUBLIC_URL: 'https://example.test',
  ADMIN_PUBLIC_URL: 'https://admin.example.test',
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_JWT_SECRET: 'x'.repeat(48),
  GIFT_CARD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
};

const ZARINPAL = {
  ZARINPAL_ENABLED: 'true',
  ZARINPAL_MERCHANT_ID: 'merchant',
  ZARINPAL_REQUEST_URL: 'https://zarinpal.test/request',
  ZARINPAL_VERIFY_URL: 'https://zarinpal.test/verify',
  ZARINPAL_STARTPAY_URL: 'https://zarinpal.test/startpay',
  ZARINPAL_CALLBACK_URL: 'https://example.test/payment/callback',
};

const BAZAARPAY = {
  BAZAARPAY_ENABLED: 'true',
  BAZAARPAY_API_TOKEN: 'bp-token',
  BAZAARPAY_DESTINATION: 'barat',
};

const AMIN = {
  AMIN_ENABLED: 'true',
  AMIN_MERCHANT_ID: 'merchant-1234',
};

function parse(overrides: Record<string, unknown>) {
  return envSchema.safeParse({ ...BASE, ...overrides });
}

function messagesFor(result: ReturnType<typeof parse>, key: string): string {
  if (result.success) return '';
  return result.error.issues
    .filter((i) => i.path[0] === key)
    .map((i) => i.message)
    .join(' ');
}

describe('payment gateway selection at boot', () => {
  it('refuses production with no live gateway', () => {
    const result = parse({});

    expect(result.success).toBe(false);
    expect(messagesFor(result, 'PAYMENTS_ALLOW_MOCK')).toMatch(/No live payment gateway/u);
  });

  it('boots production on the mock gateway only when told to explicitly', () => {
    expect(parse({ PAYMENTS_ALLOW_MOCK: 'true' }).success).toBe(true);
  });

  it('does not require the flag outside production', () => {
    expect(parse({ NODE_ENV: 'development' }).success).toBe(true);
    expect(parse({ NODE_ENV: 'staging' }).success).toBe(true);
    expect(parse({ NODE_ENV: 'test' }).success).toBe(true);
  });

  it('boots production on ZarinPal', () => {
    expect(parse(ZARINPAL).success).toBe(true);
  });

  it('boots production on BazaarPay and parses its settings', () => {
    const result = parse({ ...BAZAARPAY, BAZAARPAY_AMOUNT_UNIT: 'IRT', BAZAARPAY_TIMEOUT_MS: '5000' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.BAZAARPAY_AMOUNT_UNIT).toBe('IRT');
    expect(result.success && result.data.BAZAARPAY_TIMEOUT_MS).toBe(5000);
    expect(result.success && result.data.BAZAARPAY_BASE_URL).toBeUndefined();
  });

  it('refuses both gateways at once', () => {
    const result = parse({ ...ZARINPAL, ...BAZAARPAY });

    expect(result.success).toBe(false);
    expect(messagesFor(result, 'BAZAARPAY_ENABLED')).toMatch(/exactly one rial gateway/u);
  });

  it('refuses a half-configured BazaarPay', () => {
    const result = parse({ BAZAARPAY_ENABLED: 'true', BAZAARPAY_DESTINATION: 'barat' });

    expect(result.success).toBe(false);
    expect(messagesFor(result, 'BAZAARPAY_API_TOKEN')).toMatch(/required/u);
  });

  it('rejects an unknown BazaarPay amount unit and an out-of-range timeout', () => {
    expect(parse({ ...BAZAARPAY, BAZAARPAY_AMOUNT_UNIT: 'USD' }).success).toBe(false);
    expect(parse({ ...BAZAARPAY, BAZAARPAY_TIMEOUT_MS: '0' }).success).toBe(false);
    expect(parse({ ...BAZAARPAY, BAZAARPAY_TIMEOUT_MS: '60001' }).success).toBe(false);
  });

  it('never echoes a secret value in an error message', () => {
    const result = parse({ ...ZARINPAL, ...BAZAARPAY, BAZAARPAY_API_TOKEN: 'super-secret-value' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('super-secret-value');
  });
});

describe('BAZAARPAY_AUTO_LOGIN', () => {
  it('is off unless explicitly turned on, and blank means off', () => {
    expect(parse(BAZAARPAY).success && parse(BAZAARPAY).data?.BAZAARPAY_AUTO_LOGIN).toBe(false);
    const blank = parse({ ...BAZAARPAY, BAZAARPAY_AUTO_LOGIN: '' });
    expect(blank.success && blank.data.BAZAARPAY_AUTO_LOGIN).toBe(false);
    const on = parse({ ...BAZAARPAY, BAZAARPAY_AUTO_LOGIN: 'true' });
    expect(on.success && on.data.BAZAARPAY_AUTO_LOGIN).toBe(true);
  });

  it('refuses a value that is neither true nor false rather than guessing', () => {
    expect(parse({ ...BAZAARPAY, BAZAARPAY_AUTO_LOGIN: 'maybe' }).success).toBe(false);
  });
});

describe('Amin gateway at boot', () => {
  it('boots production on Amin alone and parses its settings', () => {
    const result = parse({ ...AMIN, AMIN_TIMEOUT_MS: '2500', AMIN_BASE_URL: 'https://sandbox.example' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.AMIN_TIMEOUT_MS).toBe(2500);
    expect(result.success && result.data.AMIN_BASE_URL).toBe('https://sandbox.example');
  });

  it('counts as a live gateway, so production does not demand the mock flag', () => {
    expect(messagesFor(parse(AMIN), 'PAYMENTS_ALLOW_MOCK')).toBe('');
  });

  it('is off by default, even if a merchant id is present', () => {
    const result = parse({ AMIN_MERCHANT_ID: 'merchant-1234', PAYMENTS_ALLOW_MOCK: 'true' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.AMIN_ENABLED).toBe(false);
  });

  it('refuses to be on without its merchant id, treating blank as unset', () => {
    expect(messagesFor(parse({ AMIN_ENABLED: 'true' }), 'AMIN_MERCHANT_ID')).toMatch(/required/u);
    expect(messagesFor(parse({ AMIN_ENABLED: 'true', AMIN_MERCHANT_ID: '   ' }), 'AMIN_MERCHANT_ID')).toMatch(
      /required/u,
    );
  });

  it('refuses Amin together with either other gateway', () => {
    expect(messagesFor(parse({ ...ZARINPAL, ...AMIN }), 'AMIN_ENABLED')).toMatch(/exactly one rial gateway/u);
    expect(messagesFor(parse({ ...BAZAARPAY, ...AMIN }), 'AMIN_ENABLED')).toMatch(/exactly one rial gateway/u);
    expect(parse({ ...ZARINPAL, ...BAZAARPAY, ...AMIN }).success).toBe(false);
  });

  it('refuses a fixed login code while Amin takes payments', () => {
    const result = parse({ NODE_ENV: 'staging', ...AMIN, OTP_DEV_FIXED_CODE: '123456' });

    expect(result.success).toBe(false);
    expect(messagesFor(result, 'OTP_DEV_FIXED_CODE')).toMatch(/AMIN_ENABLED/u);
  });

  it('rejects an out-of-range timeout and a non-URL base', () => {
    expect(parse({ ...AMIN, AMIN_TIMEOUT_MS: '0' }).success).toBe(false);
    expect(parse({ ...AMIN, AMIN_TIMEOUT_MS: '60001' }).success).toBe(false);
    expect(parse({ ...AMIN, AMIN_BASE_URL: 'not a url' }).success).toBe(false);
  });

  it('never echoes the merchant id in an error message', () => {
    const result = parse({ ...ZARINPAL, ...AMIN, AMIN_MERCHANT_ID: 'super-secret-merchant' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).not.toContain('super-secret-merchant');
  });
});

describe('INTERNAL_SERVICE_TOKEN', () => {
  it('is optional, and blank means unset', () => {
    const result = parse({ PAYMENTS_ALLOW_MOCK: 'true', INTERNAL_SERVICE_TOKEN: '' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.INTERNAL_SERVICE_TOKEN).toBeUndefined();
  });

  it('must be at least 32 characters when set', () => {
    expect(parse({ PAYMENTS_ALLOW_MOCK: 'true', INTERNAL_SERVICE_TOKEN: 'short' }).success).toBe(false);
    expect(parse({ PAYMENTS_ALLOW_MOCK: 'true', INTERNAL_SERVICE_TOKEN: 't'.repeat(32) }).success).toBe(true);
  });
});
