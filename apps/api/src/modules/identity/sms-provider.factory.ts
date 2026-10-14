import {
  IppanelSmsProvider,
  MockSmsProvider,
  type SmsProvider,
} from '@barat/notifications';

import { readIppanelEnv, type IppanelEnv } from './ippanel.env';

/**
 * Chooses the SMS transport at boot.
 *
 * Kept out of the module file so the selection rule can be unit-tested without
 * standing up Nest or Prisma, and so there is one readable place that decides
 * whether a real OTP leaves the building.
 *
 * When IPPanel is enabled its adapter validates every setting in its
 * constructor, so a half-configured deployment fails at boot rather than on the
 * first customer login.
 */
export function createSmsProvider(
  ippanel: IppanelEnv = readIppanelEnv(),
): SmsProvider {
  if (!ippanel.enabled) return new MockSmsProvider();

  return new IppanelSmsProvider({
    apiKey: ippanel.apiKey,
    patternCode: ippanel.patternCode,
    fromNumber: ippanel.fromNumber,
    patternCodeParam: ippanel.patternCodeParam,
    timeoutMs: ippanel.timeoutMs,
    ...(ippanel.baseUrl === undefined ? {} : { baseUrl: ippanel.baseUrl }),
  });
}
