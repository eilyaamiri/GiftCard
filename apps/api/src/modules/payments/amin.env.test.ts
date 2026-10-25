import { describe, expect, it } from 'vitest';

import { readAminEnv } from './amin.env';

describe('readAminEnv', () => {
  it('is off when AMIN_ENABLED is unset or blank', () => {
    expect(readAminEnv({}).enabled).toBe(false);
    expect(readAminEnv({ AMIN_ENABLED: '  ' }).enabled).toBe(false);
  });

  it('is on only for an explicit true', () => {
    const merchant = { AMIN_MERCHANT_ID: 'abc-123' };
    expect(readAminEnv({ ...merchant, AMIN_ENABLED: 'true' }).enabled).toBe(true);
    expect(readAminEnv({ ...merchant, AMIN_ENABLED: ' TRUE ' }).enabled).toBe(true);
    expect(readAminEnv({ ...merchant, AMIN_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('refuses a value that is neither, rather than guessing', () => {
    expect(() => readAminEnv({ AMIN_ENABLED: 'yes' })).toThrow('AMIN_ENABLED must be "true" or "false"');
    expect(() => readAminEnv({ AMIN_ENABLED: '1' })).toThrow('AMIN_ENABLED must be "true" or "false"');
  });

  it('requires the merchant identifier only when the gateway is on', () => {
    expect(() => readAminEnv({ AMIN_ENABLED: 'true' })).toThrow(
      'AMIN_MERCHANT_ID is required when AMIN_ENABLED is true',
    );
    expect(() => readAminEnv({ AMIN_ENABLED: 'true', AMIN_MERCHANT_ID: '   ' })).toThrow(
      'AMIN_MERCHANT_ID is required when AMIN_ENABLED is true',
    );
    expect(readAminEnv({ AMIN_ENABLED: 'false' }).merchantId).toBe('');
  });

  it('trims the merchant identifier', () => {
    expect(readAminEnv({ AMIN_ENABLED: 'true', AMIN_MERCHANT_ID: '  abc-123  ' }).merchantId).toBe('abc-123');
  });

  it('keeps a blank base URL as undefined so the production API is used', () => {
    expect(readAminEnv({}).baseUrl).toBeUndefined();
    expect(readAminEnv({ AMIN_BASE_URL: '   ' }).baseUrl).toBeUndefined();
    expect(readAminEnv({ AMIN_BASE_URL: 'https://sandbox.example' }).baseUrl).toBe('https://sandbox.example');
  });

  it('defaults the timeout and refuses one out of range', () => {
    expect(readAminEnv({}).timeoutMs).toBe(10_000);
    expect(readAminEnv({ AMIN_TIMEOUT_MS: '2500' }).timeoutMs).toBe(2_500);
    expect(() => readAminEnv({ AMIN_TIMEOUT_MS: '0' })).toThrow(/AMIN_TIMEOUT_MS/u);
    expect(() => readAminEnv({ AMIN_TIMEOUT_MS: '60001' })).toThrow(/AMIN_TIMEOUT_MS/u);
    expect(() => readAminEnv({ AMIN_TIMEOUT_MS: 'soon' })).toThrow(/AMIN_TIMEOUT_MS/u);
  });
});
