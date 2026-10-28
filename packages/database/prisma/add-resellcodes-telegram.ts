/**
 * ============================================================================
 * RESELLCODES TELEGRAM CATALOGUE — Stars and Premium, added switched off.
 * ============================================================================
 *
 * Adds the `resellcodes-telegram` Supplier and its two top-up games, next to the
 * FazerCards ones and never in place of them:
 *
 *   - Telegram Stars   slug `telegram-stars-resellcodes`    (12 packages)
 *   - Telegram Premium slug `telegram-premium-resellcodes` (3, 6, 12 months)
 *
 * Everything is created inactive with a zero cost placeholder, exactly as the
 * FazerCards Telegram seed does: prices are read live from the venue at quote
 * time, so no price is ever stored here. The storefront shows the first active
 * Telegram game it finds for each product, so switching a product from one venue
 * to the other is: activate the new game, deactivate the old.
 *
 * Create-only (`update: {}`): re-running adds what is missing and never rewrites
 * a row an operator has changed. It opens no venue connection and needs no key.
 *
 * Usage:  tsx prisma/add-resellcodes-telegram.ts
 * ============================================================================
 */

import { SupplierIntegrationMode } from '../generated/client';
import type { PrismaClient } from '../generated/client';

const SUPPLIER_CODE = 'resellcodes-telegram';

const STARS = [50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000] as const;
const PREMIUM_MONTHS = [3, 6, 12] as const;

const GAMES = [
  {
    slug: 'telegram-stars-resellcodes',
    providerCategoryId: 'stars',
    name: 'Telegram Stars',
    nameFa: 'استارز تلگرام',
    offers: STARS.map((quantity) => ({
      providerOfferId: String(quantity),
      name: `${String(quantity)} Stars`,
      nameFa: `${String(quantity)} استارز`,
    })),
  },
  {
    slug: 'telegram-premium-resellcodes',
    providerCategoryId: 'premium',
    name: 'Telegram Premium',
    nameFa: 'تلگرام پرمیوم',
    offers: PREMIUM_MONTHS.map((months) => ({
      providerOfferId: String(months),
      name: `${String(months)}-month Premium`,
      nameFa: `پرمیوم ${String(months)} ماهه`,
    })),
  },
] as const;

export async function addResellCodesTelegram(prisma: PrismaClient): Promise<{ games: number; offers: number }> {
  const supplier = await prisma.supplier.upsert({
    where: { code: SUPPLIER_CODE },
    create: {
      id: 'seed_supplier_resellcodes_telegram',
      code: SUPPLIER_CODE,
      name: 'ReSellCodes Telegram',
      integrationMode: SupplierIntegrationMode.API,
      supportsRawCode: false,
      defaultCurrency: 'USD',
      isActive: false,
      notes:
        'Telegram Stars/Premium via resell.codes. No sandbox and no idempotency key: activate only after a supervised low-value order. Prices are read live.',
    },
    update: {},
  });

  let offers = 0;
  for (const [gameIndex, definition] of GAMES.entries()) {
    const gameId = `seed_topup_game_${definition.slug.replaceAll('-', '_')}`;
    const game = await prisma.topUpGame.upsert({
      where: { slug: definition.slug },
      create: {
        id: gameId,
        slug: definition.slug,
        supplierId: supplier.id,
        providerCategoryId: definition.providerCategoryId,
        name: definition.name,
        nameFa: definition.nameFa,
        brandName: 'Telegram',
        region: 'GLOBAL',
        providerNote: 'Enter a Telegram username. Price is fetched live at quote time.',
        isActive: false,
        isListed: true,
        requiresCredentials: false,
        sortOrder: gameIndex,
      },
      update: {},
    });

    await prisma.topUpField.upsert({
      where: { gameId_key: { gameId: game.id, key: 'telegram_username' } },
      create: {
        id: `${gameId}_field_telegram_username`,
        gameId: game.id,
        key: 'telegram_username',
        label: 'Telegram username',
        labelFa: 'نام کاربری تلگرام',
        isRequired: true,
        helpTextFa: 'نام کاربری عمومی تلگرام را با یا بدون @ وارد کنید.',
        sortOrder: 0,
      },
      update: {},
    });

    for (const [offerIndex, offer] of definition.offers.entries()) {
      await prisma.topUpOffer.upsert({
        where: { gameId_providerOfferId: { gameId: game.id, providerOfferId: offer.providerOfferId } },
        create: {
          id: `${gameId}_offer_${offer.providerOfferId}`,
          gameId: game.id,
          providerOfferId: offer.providerOfferId,
          name: offer.name,
          nameFa: offer.nameFa,
          /* Never a stored price: the quote reads the venue live. */
          costAmount: '0.0000',
          costCurrency: 'USD',
          isActive: false,
          isListed: true,
          sortOrder: offerIndex,
        },
        update: {},
      });
      offers += 1;
    }
  }
  return { games: GAMES.length, offers };
}

async function main(): Promise<void> {
  const { createPrismaClient } = (await import('../src/client')) as { createPrismaClient: () => PrismaClient };
  const prisma = createPrismaClient();
  try {
    const result = await addResellCodesTelegram(prisma);
    const [activeGames, activeOffers] = await Promise.all([
      prisma.topUpGame.count({ where: { supplier: { code: SUPPLIER_CODE }, isActive: true } }),
      prisma.topUpOffer.count({ where: { game: { supplier: { code: SUPPLIER_CODE } }, isActive: true } }),
    ]);
    console.log(
      `[telegram] ensured ${String(result.games)} games and ${String(result.offers)} offers under "${SUPPLIER_CODE}". ` +
        `Active among them: ${String(activeGames)} games, ${String(activeOffers)} offers.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (/add-resellcodes-telegram\.[cm]?[jt]s$/u.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(`[telegram] failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
