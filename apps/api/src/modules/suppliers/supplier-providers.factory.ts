import { Logger } from '@nestjs/common';
import {
  FazerCardsTelegramSupplierProvider,
  MockSupplierProvider,
  ReloadlyGiftCardSupplierProvider,
  type SupplierProvider,
} from '@barat/suppliers';

import { readFazerCardsTelegramEnv, readReloadlyEnv } from './suppliers.env';

/**
 * Turns the environment into the adapter list bound to `SUPPLIER_PROVIDERS`.
 *
 * This lives outside `suppliers.module.ts` so it can be exercised without
 * booting Nest: importing the module pulls in the global config module, which
 * validates every environment variable the API has.
 */
export function buildSupplierProviders(options: {
  readonly isTest: boolean;
}): readonly SupplierProvider[] {
  const logger = new Logger('SuppliersModule');
  const providers: SupplierProvider[] = [new MockSupplierProvider()];

  /*
   * Telegram is gated by its own flag, independent of every other FazerCards
   * product: they share one API key, so the key's presence must never decide
   * which product may spend. `isTest` outranks the flag for the same reason it
   * does below — a test run that reached the live venue would buy real Stars.
   */
  const telegram = readFazerCardsTelegramEnv();
  if (telegram.enabled && !options.isTest) {
    providers.push(
      new FazerCardsTelegramSupplierProvider({
        apiKey: telegram.apiKey,
        timeoutMs: telegram.timeoutMs,
      }),
    );
    /* Environment only — never the API key. */
    logger.log('FazerCards Telegram registered');
  } else {
    logger.warn('FazerCards Telegram is not registered; its offers can only be fulfilled by an operator');
  }

  const reloadly = readReloadlyEnv();
  if (!reloadly.enabled || options.isTest) {
    /*
     * Registering the adapter is what makes `SuppliersService` willing to spend
     * real money, so it is never inferred from the presence of credentials:
     * deploying the secrets and deciding to go live are two separate acts, and
     * the second one is a human release gate (AGENTS.md section 4.5). Until it
     * is taken, Reloadly offers fall through to an operator work item.
     */
    logger.warn('Reloadly is not registered; its offers can only be fulfilled by an operator');
    return providers;
  }

  providers.push(
    new ReloadlyGiftCardSupplierProvider({
      clientId: reloadly.clientId,
      clientSecret: reloadly.clientSecret,
      environment: reloadly.environment,
      recipientEmail: reloadly.recipientEmail,
      timeoutMs: reloadly.timeoutMs,
      ...(reloadly.senderName === undefined ? {} : { senderName: reloadly.senderName }),
    }),
  );
  /* Environment only — never the client id, the secret or the mailbox. */
  logger.log(`Reloadly registered against the ${reloadly.environment} environment`);
  return providers;
}
