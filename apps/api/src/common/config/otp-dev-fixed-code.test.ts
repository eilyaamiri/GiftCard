import { describe, expect, it } from 'vitest';

import { envSchema } from './env.schema';

/**
 * OTP_DEV_FIXED_CODE pins every login code to one value so a demo deployment
 * with no SMS gateway can still be signed into. It trades away the only thing
 * an OTP proves — possession of the phone — so the guard rails around it are
 * the feature, not the switch itself.
 */

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
};

function parse(overrides: Record<string, unknown>) {
  return envSchema.safeParse({ ...BASE, ...overrides });
}

function messagesFor(result: ReturnType<typeof parse>, key: string): string[] {
  if (result.success) return [];
  return result.error.issues.filter((i) => i.path[0] === key).map((i) => i.message);
}

describe('OTP_DEV_FIXED_CODE', () => {
  it('is absent by default, so a normal deployment issues random codes', () => {
    const result = parse({});

    expect(result.success).toBe(true);
    expect(result.success && result.data.OTP_DEV_FIXED_CODE).toBeUndefined();
  });

  it('accepts a code of exactly OTP_LENGTH digits', () => {
    const result = parse({ OTP_DEV_FIXED_CODE: '123456' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.OTP_DEV_FIXED_CODE).toBe('123456');
  });

  it('refuses to boot when a live payment gateway is configured', () => {
    /* The interlock that stops this being forgotten in an env file: a fixed
     * login code lets anyone sign in as anyone, which is not survivable once
     * real money moves. */
    const result = parse({
      OTP_DEV_FIXED_CODE: '123456',
      ZARINPAL_ENABLED: 'true',
      ZARINPAL_MERCHANT_ID: 'merchant',
      ZARINPAL_REQUEST_URL: 'https://zarinpal.test/request',
      ZARINPAL_VERIFY_URL: 'https://zarinpal.test/verify',
      ZARINPAL_STARTPAY_URL: 'https://zarinpal.test/startpay',
      ZARINPAL_CALLBACK_URL: 'https://example.test/payment/callback',
    });

    expect(result.success).toBe(false);
    expect(messagesFor(result, 'OTP_DEV_FIXED_CODE').join(' ')).toMatch(/ZARINPAL_ENABLED/u);
  });

  it('rejects a code whose length does not match OTP_LENGTH', () => {
    /* The login form would reject it client-side, which reads as "the fixed
     * code does not work" rather than as a misconfiguration. Fail at boot. */
    expect(parse({ OTP_DEV_FIXED_CODE: '1234' }).success).toBe(false);
    expect(parse({ OTP_DEV_FIXED_CODE: '1234', OTP_LENGTH: '4' }).success).toBe(true);
  });

  it('rejects anything that is not digits', () => {
    expect(parse({ OTP_DEV_FIXED_CODE: 'abcdef' }).success).toBe(false);
    expect(parse({ OTP_DEV_FIXED_CODE: '12 456' }).success).toBe(false);
  });

  it('treats a blank value as not configured', () => {
    /* `OTP_DEV_FIXED_CODE=` in an env file is how an operator says "off". */
    const result = parse({ OTP_DEV_FIXED_CODE: '' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.OTP_DEV_FIXED_CODE).toBeUndefined();
  });
});
