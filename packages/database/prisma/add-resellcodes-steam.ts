/**
 * ============================================================================
 * RESELLCODES STEAM WALLET — one game, added switched off.
 * ============================================================================
 *
 * Adds the `resellcodes-steam` Supplier and its Steam wallet game next to the
 * FazerCards one (`steam-wallet`), never in place of it:
 *
 *   - Steam Wallet   slug `steam-wallet-resellcodes`
 *     one field `steam_login`, one template offer `custom` (the customer types
 *     the USD amount; the quote binds it into `steam:usd:<amount>`)
 *
 * Everything is created inactive with a zero cost placeholder, exactly as the
 * FazerCards Steam seed does: the cost is read from the venue at quote time.
 * The storefront shows the first active Steam game it finds, so choosing the
 * venue is: activate one game, deactivate the other.
 *
 * Create-only (`update: {}`): a re-run adds what is missing and never rewrites
 * a row an operator has changed. It opens no venue connection and needs no key.
 *
 * Usage:  tsx prisma/add-resellcodes-steam.ts
 * ============================================================================
 */

import { SupplierIntegrationMode } from '../generated/client';
import type { PrismaClient } from '../generated/client';

const SUPPLIER_CODE = 'resellcodes-steam';
const GAME_SLUG = 'steam-wallet-resellcodes';
const GAME_ID = 'seed_topup_game_steam_wallet_resellcodes';

export async function addResellCodesSteam(prisma: PrismaClient): Promise<void> {
  const supplier = await prisma.supplier.upsert({
    where: { code: SUPPLIER_CODE },
    create: {
      id: 'seed_supplier_resellcodes_steam',
      code: SUPPLIER_CODE,
      name: 'ReSellCodes Steam',
      integrationMode: SupplierIntegrationMode.API,
      supportsRawCode: false,
      defaultCurrency: 'USD',
      isActive: false,
      notes:
        'Steam wallet top-up by login via resell.codes. Charged face value minus the account discount; no sandbox and no idempotency key: activate only after a supervised low-value order.',
    },
    update: {},
  });

  const game = await prisma.topUpGame.upsert({
    where: { slug: GAME_SLUG },
    create: {
      id: GAME_ID,
      slug: GAME_SLUG,
      supplierId: supplier.id,
      providerCategoryId: 'usd',
      name: 'Steam Wallet',
      nameFa: 'شارژ کیف پول استیم',
      brandName: 'Steam',
      region: 'GLOBAL',
      providerNote: 'Enter the Steam login (not the display name). Price is fetched live at quote time.',
      isActive: false,
      isListed: true,
      requiresCredentials: false,
      sortOrder: 0,
    },
    update: {},
  });

  await prisma.topUpField.upsert({
    where: { gameId_key: { gameId: game.id, key: 'steam_login' } },
    create: {
      id: `${GAME_ID}_field_steam_login`,
      gameId: game.id,
      key: 'steam_login',
      label: 'Steam login',
      labelFa: 'شناسه ورود استیم',
      isRequired: true,
      helpTextFa: 'شناسه ورود (Login) حساب استیم را وارد کنید؛ نه نام نمایشی.',
      sortOrder: 0,
    },
    update: {},
  });

  await prisma.topUpOffer.upsert({
    where: { gameId_providerOfferId: { gameId: game.id, providerOfferId: 'custom' } },
    create: {
      id: `${GAME_ID}_offer_custom`,
      gameId: game.id,
      providerOfferId: 'custom',
      name: 'Steam Wallet (custom USD amount)',
      nameFa: 'اعتبار استیم، مبلغ دلخواه',
      /* Never a stored price: the quote reads the venue live. */
      costAmount: '0.0000',
      costCurrency: 'USD',
      isActive: false,
      isListed: true,
      sortOrder: 0,
    },
    update: {},
  });
}

async function main(): Promise<void> {
  const { createPrismaClient } = (await import('../src/client')) as { createPrismaClient: () => PrismaClient };
  const prisma = createPrismaClient();
  try {
    await addResellCodesSteam(prisma);
    const [games, activeGames, activeOffers] = await Promise.all([
      prisma.topUpGame.count({ where: { supplier: { code: SUPPLIER_CODE } } }),
      prisma.topUpGame.count({ where: { supplier: { code: SUPPLIER_CODE }, isActive: true } }),
      prisma.topUpOffer.count({ where: { game: { supplier: { code: SUPPLIER_CODE } }, isActive: true } }),
    ]);
    console.log(
      `[steam] ensured ${String(games)} game under "${SUPPLIER_CODE}" (${GAME_SLUG}). ` +
        `Active among them: ${String(activeGames)} games, ${String(activeOffers)} offers.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (/add-resellcodes-steam\.[cm]?[jt]s$/u.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(`[steam] failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
