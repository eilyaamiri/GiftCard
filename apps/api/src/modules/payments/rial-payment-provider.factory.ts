import {
  BazaarPayPaymentProvider,
  MockRialPaymentProvider,
  ZarinPalPaymentProvider,
  type RialPaymentProvider,
} from '@barat/payments';

import type { AppConfigService } from '../../common/config';

/**
 * Chooses exactly one rial gateway adapter at boot.
 *
 * Kept out of the module file so it can be unit-tested without pulling in the
 * Prisma singleton, and so the selection rule lives in one readable place.
 *
 * Exactly one live gateway may take payments. ZarinPal and BazaarPay both being
 * enabled is refused at boot rather than resolved by a silent precedence rule:
 * which gateway a customer is sent to must never depend on an ordering nobody
 * wrote down.
 *
 * When a gateway is enabled its adapter validates every setting in its
 * constructor, so a half-configured production deployment fails at boot rather
 * than on the first customer payment.
 *
 * The environment schema already refuses each unsafe combination below. They
 * are checked again here because this is the line that actually hands out the
 * mock gateway, and a mock that reports every payment as paid must never be
 * reachable in production by a path the schema did not foresee.
 */
export function createRialPaymentProvider(config: AppConfigService): RialPaymentProvider {
  const bazaarPay = config.bazaarPay;

  if (bazaarPay !== null) {
    if (config.zarinpalEnabled) {
      throw new Error(
        'ZARINPAL_ENABLED and BAZAARPAY_ENABLED are both true: exactly one rial gateway may take payments',
      );
    }
    if (config.otpDevFixedCode) {
      throw new Error(
        'OTP_DEV_FIXED_CODE must not be set while BAZAARPAY_ENABLED is true — a fixed login code ' +
          'lets anyone sign in as any mobile number, which is not survivable on a deployment ' +
          'that accepts payments',
      );
    }

    return new BazaarPayPaymentProvider({
      apiToken: bazaarPay.apiToken,
      destination: bazaarPay.destination,
      returnUrl: `${config.apiPublicUrl}/api/payments/bazaarpay/return`,
      amountUnit: bazaarPay.amountUnit,
      timeoutMs: bazaarPay.timeoutMs,
      ...(bazaarPay.baseUrl === undefined ? {} : { baseUrl: bazaarPay.baseUrl }),
    });
  }

  const settings = config.zarinpal;
  if (config.zarinpalEnabled && settings !== null) {
    return new ZarinPalPaymentProvider({
      merchantId: settings.merchantId,
      callbackUrl: settings.callbackUrl,
      amountUnit: settings.amountUnit,
      requestUrl: settings.requestUrl,
      verifyUrl: settings.verifyUrl,
      startPayUrl: settings.startPayUrl,
      timeoutMs: settings.timeoutMs,
    });
  }

  if (!config.paymentsAllowMock) {
    throw new Error(
      'No live payment gateway is enabled in production and PAYMENTS_ALLOW_MOCK is not set: ' +
        'refusing to start on the mock gateway, which reports every payment as paid',
    );
  }

  return new MockRialPaymentProvider();
}
