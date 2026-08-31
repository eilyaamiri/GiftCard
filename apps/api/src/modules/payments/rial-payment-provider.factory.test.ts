import { describe, expect, it } from 'vitest';
import { MockRialPaymentProvider, ZarinPalPaymentProvider } from '@barat/payments';

import type { AppConfigService } from '../../common/config';
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
