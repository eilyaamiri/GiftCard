import { describe, expect, it } from 'vitest';

import { readBazaarPayEnv } from './bazaarpay.env';

describe('readBazaarPayEnv BAZAARPAY_AUTO_LOGIN', () => {
  it('is off when unset or blank', () => {
    expect(readBazaarPayEnv({}).autoLogin).toBe(false);
    expect(readBazaarPayEnv({ BAZAARPAY_AUTO_LOGIN: '  ' }).autoLogin).toBe(false);
  });

  it('is on only for an explicit true', () => {
    expect(readBazaarPayEnv({ BAZAARPAY_AUTO_LOGIN: 'true' }).autoLogin).toBe(true);
    expect(readBazaarPayEnv({ BAZAARPAY_AUTO_LOGIN: ' TRUE ' }).autoLogin).toBe(true);
    expect(readBazaarPayEnv({ BAZAARPAY_AUTO_LOGIN: 'false' }).autoLogin).toBe(false);
  });

  it('refuses a value that is neither, rather than guessing', () => {
    expect(() => readBazaarPayEnv({ BAZAARPAY_AUTO_LOGIN: 'yes' })).toThrow(
      'BAZAARPAY_AUTO_LOGIN must be "true" or "false"',
    );
  });

  it('keeps the existing BAZAARPAY_ENABLED validation', () => {
    expect(() => readBazaarPayEnv({ BAZAARPAY_ENABLED: '1' })).toThrow(
      'BAZAARPAY_ENABLED must be "true" or "false"',
    );
  });
});
