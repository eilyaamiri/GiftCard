import { describe, expect, it } from 'vitest';
import { AminPaymentProvider, MockRialPaymentProvider, ZarinPalPaymentProvider } from '@barat/payments';

import type { AppConfigService } from '../../common/config';
import type { AminEnv } from './amin.env';
import type { BazaarPayEnv } from './bazaarpay.env';
import { createRialPaymentProvider } from './rial-payment-provider.factory';

type ZarinPalSettings = NonNullable<AppConfigService['zarinpal']>;

const VALID_SETTINGS: ZarinPalSettings = {
  merchantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  requestUrl: 'https://api.zarinpal.com/pg/v4/payment/request.json',
  verifyUrl: 'https://api.zarinpal.com/pg/v4/payment/verify.json',
  startPayUrl: 'https://www.zarinpal.com/pg/StartPay',
  callbackUrl: 'https://api.barat.test/api/payments/zarinpal/callback',
  timeoutMs: 10_000,
  amountUnit: 'IRR',
};

function configStub(enabled: boolean, settings: ZarinPalSettings | null): AppConfigService {
  return { zarinpalEnabled: enabled, zarinpal: settings } as unknown as AppConfigService;
}

describe('createRialPaymentProvider', () => {
  it('selects the mock provider when ZarinPal is disabled', () => {
    expect(createRialPaymentProvider(configStub(false, null))).toBeInstanceOf(
      MockRialPaymentProvider,
    );
  });

  it('selects the mock provider when the flag is on but settings are absent', () => {
    expect(createRialPaymentProvider(configStub(true, null))).toBeInstanceOf(
      MockRialPaymentProvider,
    );
  });

  it('selects the ZarinPal provider when enabled and fully configured', () => {
    const provider = createRialPaymentProvider(configStub(true, VALID_SETTINGS));

    expect(provider).toBeInstanceOf(ZarinPalPaymentProvider);
    expect(provider.name).toBe('zarinpal');
  });

  it('honours the configured amount unit', () => {
    expect(
      createRialPaymentProvider(configStub(true, { ...VALID_SETTINGS, amountUnit: 'IRT' })).name,
    ).toBe('zarinpal');
  });

  it('fails at boot rather than at the first payment when the merchant id is missing', () => {
    expect(() => createRialPaymentProvider(configStub(true, { ...VALID_SETTINGS, merchantId: '' }))).toThrow(
      /merchant identifier is invalid/u,
    );
  });

  it('fails at boot when the callback URL is not a URL', () => {
    expect(() =>
      createRialPaymentProvider(configStub(true, { ...VALID_SETTINGS, callbackUrl: '' })),
    ).toThrow(/callback URL is invalid/u);
  });

  it('fails at boot when the timeout is out of range', () => {
    expect(() =>
      createRialPaymentProvider(configStub(true, { ...VALID_SETTINGS, timeoutMs: 0 })),
    ).toThrow(/timeout/u);
  });
});

describe('createRialPaymentProvider with Amin', () => {
  const AMIN_ON: AminEnv = { enabled: true, merchantId: 'merchant-1234', baseUrl: undefined, timeoutMs: 10_000 };
  const AMIN_OFF: AminEnv = { ...AMIN_ON, enabled: false };
  const BAZAARPAY_OFF: BazaarPayEnv = {
    enabled: false,
    apiToken: '',
    destination: '',
    baseUrl: undefined,
    amountUnit: 'IRR',
    timeoutMs: 10_000,
    autoLogin: false,
  };

  function config(overrides: Record<string, unknown> = {}): AppConfigService {
    return {
      zarinpalEnabled: false,
      zarinpal: null,
      otpDevFixedCode: null,
      apiPublicUrl: 'https://api.barat.test',
      ...overrides,
    } as unknown as AppConfigService;
  }

  it('selects Amin when it is the only gateway enabled', () => {
    const provider = createRialPaymentProvider(config(), BAZAARPAY_OFF, AMIN_ON);
    expect(provider).toBeInstanceOf(AminPaymentProvider);
    expect(provider.name).toBe('amin');
  });

  it('stays on the default gateway when Amin is off, even if an identifier is present', () => {
    const provider = createRialPaymentProvider(config(), BAZAARPAY_OFF, AMIN_OFF);
    expect(provider).toBeInstanceOf(MockRialPaymentProvider);
  });

  it('refuses Amin together with ZarinPal rather than choosing one', () => {
    expect(() =>
      createRialPaymentProvider(config({ zarinpalEnabled: true, zarinpal: VALID_SETTINGS }), BAZAARPAY_OFF, AMIN_ON),
    ).toThrow('ZARINPAL_ENABLED and AMIN_ENABLED are both true');
  });

  it('refuses Amin together with BazaarPay rather than choosing one', () => {
    const bazaarPayOn: BazaarPayEnv = { ...BAZAARPAY_OFF, enabled: true, apiToken: 't', destination: 'd' };
    expect(() => createRialPaymentProvider(config(), bazaarPayOn, AMIN_ON)).toThrow(
      'BAZAARPAY_ENABLED and AMIN_ENABLED are both true',
    );
  });

  it('refuses a fixed login code on a deployment that takes Amin payments', () => {
    expect(() => createRialPaymentProvider(config({ otpDevFixedCode: '123456' }), BAZAARPAY_OFF, AMIN_ON)).toThrow(
      /OTP_DEV_FIXED_CODE must not be set while AMIN_ENABLED is true/u,
    );
  });

  it('fails at boot, without echoing the identifier, when the merchant id is malformed', () => {
    const bad: AminEnv = { ...AMIN_ON, merchantId: 'bad id with spaces' };
    try {
      createRialPaymentProvider(config(), BAZAARPAY_OFF, bad);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).toMatch(/merchant identifier is invalid/u);
      expect(String(error)).not.toContain('bad id with spaces');
    }
  });

  it('fails at boot when the public API URL is not a URL', () => {
    expect(() => createRialPaymentProvider(config({ apiPublicUrl: 'nope' }), BAZAARPAY_OFF, AMIN_ON)).toThrow(
      /return URL is invalid/u,
    );
  });

  it('honours a configured base URL', () => {
    const provider = createRialPaymentProvider(
      config(),
      BAZAARPAY_OFF,
      { ...AMIN_ON, baseUrl: 'https://sandbox.example' },
    );
    expect(provider.name).toBe('amin');
  });
});
