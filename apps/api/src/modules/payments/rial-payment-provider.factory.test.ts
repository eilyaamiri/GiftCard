import { describe, expect, it } from 'vitest';
import {
  AminPaymentProvider,
  BazaarPayPaymentProvider,
  MockRialPaymentProvider,
  ZarinPalPaymentProvider,
} from '@barat/payments';

import type { AppConfigService } from '../../common/config';
import { createRialPaymentProvider } from './rial-payment-provider.factory';

type ZarinPalSettings = NonNullable<AppConfigService['zarinpal']>;
type BazaarPaySettings = NonNullable<AppConfigService['bazaarPay']>;
type AminSettings = NonNullable<AppConfigService['amin']>;

const VALID_SETTINGS: ZarinPalSettings = {
  merchantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  requestUrl: 'https://api.zarinpal.com/pg/v4/payment/request.json',
  verifyUrl: 'https://api.zarinpal.com/pg/v4/payment/verify.json',
  startPayUrl: 'https://www.zarinpal.com/pg/StartPay',
  callbackUrl: 'https://api.barat.test/api/payments/zarinpal/callback',
  timeoutMs: 10_000,
  amountUnit: 'IRR',
};

const BAZAARPAY_SETTINGS: BazaarPaySettings = {
  apiToken: 'bp-token',
  destination: 'barat',
  baseUrl: undefined,
  amountUnit: 'IRR',
  timeoutMs: 10_000,
  autoLogin: false,
};

const AMIN_SETTINGS: AminSettings = {
  merchantId: 'merchant-1234',
  baseUrl: undefined,
  timeoutMs: 10_000,
};

interface StubOptions {
  zarinpalEnabled?: boolean;
  zarinpal?: ZarinPalSettings | null;
  bazaarPay?: BazaarPaySettings | null;
  amin?: AminSettings | null;
  paymentsAllowMock?: boolean;
  otpDevFixedCode?: string | null;
}

function configStub(options: StubOptions = {}): AppConfigService {
  return {
    zarinpalEnabled: options.zarinpalEnabled ?? false,
    zarinpal: options.zarinpal ?? null,
    bazaarPay: options.bazaarPay ?? null,
    amin: options.amin ?? null,
    paymentsAllowMock: options.paymentsAllowMock ?? true,
    otpDevFixedCode: options.otpDevFixedCode ?? null,
    apiPublicUrl: 'https://api.barat.test',
  } as unknown as AppConfigService;
}

const zarinpalOn = (settings: Partial<ZarinPalSettings> = {}): AppConfigService =>
  configStub({ zarinpalEnabled: true, zarinpal: { ...VALID_SETTINGS, ...settings } });

describe('createRialPaymentProvider', () => {
  it('selects the mock provider when no gateway is on and the mock is allowed', () => {
    expect(createRialPaymentProvider(configStub())).toBeInstanceOf(MockRialPaymentProvider);
  });

  it('refuses to hand out the mock when it is not allowed (production without PAYMENTS_ALLOW_MOCK)', () => {
    expect(() => createRialPaymentProvider(configStub({ paymentsAllowMock: false }))).toThrow(
      /refusing to start on the mock gateway/u,
    );
  });

  it('does not fall back to the mock when the ZarinPal flag is on but settings are absent', () => {
    expect(() =>
      createRialPaymentProvider(configStub({ zarinpalEnabled: true, zarinpal: null, paymentsAllowMock: false })),
    ).toThrow(/mock gateway/u);
  });

  it('selects the ZarinPal provider when enabled and fully configured', () => {
    const provider = createRialPaymentProvider(zarinpalOn());

    expect(provider).toBeInstanceOf(ZarinPalPaymentProvider);
    expect(provider.name).toBe('zarinpal');
  });

  it('selects ZarinPal in production without consulting the mock flag', () => {
    expect(
      createRialPaymentProvider(
        configStub({ zarinpalEnabled: true, zarinpal: VALID_SETTINGS, paymentsAllowMock: false }),
      ),
    ).toBeInstanceOf(ZarinPalPaymentProvider);
  });

  it('honours the configured amount unit', () => {
    expect(createRialPaymentProvider(zarinpalOn({ amountUnit: 'IRT' })).name).toBe('zarinpal');
  });

  it('fails at boot rather than at the first payment when the merchant id is missing', () => {
    expect(() => createRialPaymentProvider(zarinpalOn({ merchantId: '' }))).toThrow(
      /merchant identifier is invalid/u,
    );
  });

  it('fails at boot when the callback URL is not a URL', () => {
    expect(() => createRialPaymentProvider(zarinpalOn({ callbackUrl: '' }))).toThrow(
      /callback URL is invalid/u,
    );
  });

  it('fails at boot when the timeout is out of range', () => {
    expect(() => createRialPaymentProvider(zarinpalOn({ timeoutMs: 0 }))).toThrow(/timeout/u);
  });

  it('selects BazaarPay when it is the enabled gateway', () => {
    expect(
      createRialPaymentProvider(configStub({ bazaarPay: BAZAARPAY_SETTINGS, paymentsAllowMock: false })),
    ).toBeInstanceOf(BazaarPayPaymentProvider);
  });

  it('refuses both gateways at once', () => {
    expect(() =>
      createRialPaymentProvider(
        configStub({ bazaarPay: BAZAARPAY_SETTINGS, zarinpalEnabled: true, zarinpal: VALID_SETTINGS }),
      ),
    ).toThrow(/exactly one rial gateway/u);
  });

  it('refuses a fixed login code alongside BazaarPay', () => {
    expect(() =>
      createRialPaymentProvider(configStub({ bazaarPay: BAZAARPAY_SETTINGS, otpDevFixedCode: '123456' })),
    ).toThrow(/OTP_DEV_FIXED_CODE/u);
  });
});

describe('createRialPaymentProvider with Amin', () => {
  it('selects Amin when it is the only gateway enabled, in production without the mock flag', () => {
    const provider = createRialPaymentProvider(configStub({ amin: AMIN_SETTINGS, paymentsAllowMock: false }));

    expect(provider).toBeInstanceOf(AminPaymentProvider);
    expect(provider.name).toBe('amin');
  });

  it('stays on the default gateway when Amin is off, even if an identifier is present', () => {
    // `config.amin` is null whenever AMIN_ENABLED is false, whatever else is set.
    expect(createRialPaymentProvider(configStub({ amin: null }))).toBeInstanceOf(MockRialPaymentProvider);
  });

  it('refuses Amin together with ZarinPal rather than choosing one', () => {
    expect(() =>
      createRialPaymentProvider(
        configStub({ amin: AMIN_SETTINGS, zarinpalEnabled: true, zarinpal: VALID_SETTINGS }),
      ),
    ).toThrow('ZARINPAL_ENABLED and AMIN_ENABLED are both true');
  });

  it('refuses Amin together with BazaarPay rather than choosing one', () => {
    expect(() =>
      createRialPaymentProvider(configStub({ amin: AMIN_SETTINGS, bazaarPay: BAZAARPAY_SETTINGS })),
    ).toThrow('BAZAARPAY_ENABLED and AMIN_ENABLED are both true');
  });

  it('refuses a fixed login code on a deployment that takes Amin payments', () => {
    expect(() =>
      createRialPaymentProvider(configStub({ amin: AMIN_SETTINGS, otpDevFixedCode: '123456' })),
    ).toThrow(/OTP_DEV_FIXED_CODE must not be set while AMIN_ENABLED is true/u);
  });

  it('fails at boot, without echoing the identifier, when the merchant id is malformed', () => {
    try {
      createRialPaymentProvider(
        configStub({ amin: { ...AMIN_SETTINGS, merchantId: 'bad id with spaces' } }),
      );
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(String(error)).toMatch(/merchant identifier is invalid/u);
      expect(String(error)).not.toContain('bad id with spaces');
    }
  });

  it('fails at boot when the public API URL is not a URL', () => {
    const config = { ...configStub({ amin: AMIN_SETTINGS }), apiPublicUrl: 'nope' } as AppConfigService;

    expect(() => createRialPaymentProvider(config)).toThrow(/return URL is invalid/u);
  });

  it('honours a configured base URL', () => {
    const provider = createRialPaymentProvider(
      configStub({ amin: { ...AMIN_SETTINGS, baseUrl: 'https://sandbox.example' } }),
    );

    expect(provider.name).toBe('amin');
  });
});
