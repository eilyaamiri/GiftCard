import {
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
 * When ZarinPal is enabled the ZarinPal adapter validates every setting in its
 * constructor, so a half-configured production deployment fails at boot rather
 * than on the first customer payment.
 */
export function createRialPaymentProvider(config: AppConfigService): RialPaymentProvider {
  const settings = config.zarinpal;
  if (!config.zarinpalEnabled || settings === null) {
    return new MockRialPaymentProvider();
  }

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
