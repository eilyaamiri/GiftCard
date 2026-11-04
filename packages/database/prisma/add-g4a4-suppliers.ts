/**
 * ============================================================================
 * G4A4 — the two supplier rows, added switched off.
 * ============================================================================
 *
 * Adds the `g4a4` (gift cards) and `g4a4-topup` (game top-ups) Suppliers that
 * the API's G4A4 adapters are registered against. Production does not run
 * `seed.ts`, so without this the admin panel has nothing to attach offers to.
 *
 * Both are created inactive and bill in toman (`defaultCurrency: 'IRT'`).
 * Create-only (`update: {}`): a re-run adds what is missing and never rewrites
 * a row an operator has changed. It opens no venue connection and needs no key.
 *
 * Usage:  tsx prisma/add-g4a4-suppliers.ts
 * ============================================================================
 */

import { SupplierIntegrationMode } from '../generated/client';
import type { PrismaClient } from '../generated/client';

const GIFT_CARD_CODE = 'g4a4';
const TOPUP_CODE = 'g4a4-topup';

export async function addG4a4Suppliers(prisma: PrismaClient): Promise<void> {
  await prisma.supplier.upsert({
    where: { code: GIFT_CARD_CODE },
    create: {
      id: 'seed_supplier_g4a4',
      code: GIFT_CARD_CODE,
      name: 'G4A4',
      integrationMode: SupplierIntegrationMode.API,
      supportsRawCode: true,
      defaultCurrency: 'IRT',
      isActive: false,
      notes:
        'Gift cards via g4a4.com. Prices are in toman. No sandbox and no idempotency key: activate only after a supervised low-value order.',
    },
    update: {},
  });

  await prisma.supplier.upsert({
    where: { code: TOPUP_CODE },
    create: {
      id: 'seed_supplier_g4a4_topup',
      code: TOPUP_CODE,
      name: 'G4A4 Top-up',
      integrationMode: SupplierIntegrationMode.API,
      supportsRawCode: false,
      defaultCurrency: 'IRT',
      isActive: false,
      notes:
        'Game top-ups via g4a4.com. Prices are in toman. Import the catalogue from the admin top-up page, then enable games one by one.',
    },
    update: {},
  });
}

async function main(): Promise<void> {
  const { createPrismaClient } = (await import('../src/client')) as { createPrismaClient: () => PrismaClient };
  const prisma = createPrismaClient();
  try {
    await addG4a4Suppliers(prisma);
    const rows = await prisma.supplier.findMany({
      where: { code: { in: [GIFT_CARD_CODE, TOPUP_CODE] } },
      select: { code: true, isActive: true },
      orderBy: { code: 'asc' },
    });
    console.log(
      `[g4a4] ensured ${String(rows.length)} suppliers: ` +
        rows.map((row) => `${row.code} (${row.isActive ? 'active' : 'inactive'})`).join(', '),
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (/add-g4a4-suppliers\.[cm]?[jt]s$/u.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(`[g4a4] failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
