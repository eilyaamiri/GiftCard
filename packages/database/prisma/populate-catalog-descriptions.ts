/**
 * ============================================================================
 * CATALOG DESCRIPTIONS — customer-facing Persian copy sourced from the
 * gift-card / payment-service reference document.
 * ============================================================================
 *
 * Three things, all idempotent and safe to re-run against production:
 *
 *   1. Sets `Brand.descriptionFa` for the gift-card brands the reference
 *      document actually covers. Every other brand is left untouched — most
 *      of the storefront's brands have no matching content in the source, and
 *      this script must not invent copy for them.
 *   2. Sets `InternationalService.descriptionFa` on the six category-level
 *      services that already exist in every environment (see `seed.ts`'s
 *      `SERVICE_DEFS` — production runs with exactly these six rows).
 *   3. Creates the specific payment services the reference document describes
 *      that are not yet rows at all (ChatGPT, Adobe Photoshop, GoDaddy, GRE,
 *      ...), each inside one of the six existing categories. No new category
 *      is introduced — every new row's `category` is one of the six already
 *      live on the site.
 *
 * Like `import-reloadly-catalog.ts`, this writes real data and is meant to run
 * against production: ids are deterministic (`docxsvc_<slug>`), so a re-run
 * updates the same rows instead of duplicating them, and `--dry-run` reports
 * the plan without opening a database connection.
 *
 * Usage:
 *   tsx prisma/populate-catalog-descriptions.ts [--dry-run]
 * ============================================================================
 */

import { readFile } from 'node:fs/promises';

import type { PrismaClient } from '../generated/client';

const SERVICE_ID_PREFIX = 'docxsvc_';
const DATA_FILE = new URL('./data/catalog-descriptions.json', import.meta.url);

interface BrandDescription {
  slug: string;
  descriptionFa: string;
}

interface CategoryDescription {
  slug: string;
  descriptionFa: string;
}

interface NewService {
  slug: string;
  name: string;
  nameFa: string;
  category: string;
  descriptionFa: string;
}

interface CatalogDescriptions {
  brandDescriptions: BrandDescription[];
  categoryDescriptions: CategoryDescription[];
  newServices: NewService[];
}

async function loadData(): Promise<CatalogDescriptions> {
  const raw = await readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw) as CatalogDescriptions;
}

/** The two generic fields every service in `seed.ts` carries — see `SERVICE_DEFS`. */
function fieldDefs(serviceId: string): Array<{
  id: string;
  serviceId: string;
  key: string;
  label: string;
  labelFa: string;
  fieldType: 'EMAIL' | 'TEXT';
  isRequired: boolean;
  sortOrder: number;
}> {
  return [
    {
      id: `${serviceId}_f1`,
      serviceId,
      key: 'accountEmail',
      label: 'Account e-mail',
      labelFa: 'ایمیل حساب کاربری',
      fieldType: 'EMAIL',
      isRequired: true,
      sortOrder: 10,
    },
    {
      id: `${serviceId}_f2`,
      serviceId,
      key: 'invoiceReference',
      label: 'Invoice / order reference',
      labelFa: 'شمارهٔ فاکتور / سفارش',
      fieldType: 'TEXT',
      isRequired: false,
      sortOrder: 20,
    },
  ];
}

async function run(prisma: PrismaClient, data: CatalogDescriptions): Promise<void> {
  let brandsUpdated = 0;
  for (const brand of data.brandDescriptions) {
    const result = await prisma.brand.updateMany({
      where: { slug: brand.slug },
      data: { descriptionFa: brand.descriptionFa },
    });
    if (result.count === 0) {
      console.warn(`[populate] brand not found, skipped: ${brand.slug}`);
    } else {
      brandsUpdated += result.count;
    }
  }

  let categoriesUpdated = 0;
  for (const category of data.categoryDescriptions) {
    const result = await prisma.internationalService.updateMany({
      where: { slug: category.slug },
      data: { descriptionFa: category.descriptionFa },
    });
    if (result.count === 0) {
      console.warn(`[populate] category-level service not found, skipped: ${category.slug}`);
    } else {
      categoriesUpdated += result.count;
    }
  }

  let servicesCreated = 0;
  let servicesUpdated = 0;
  for (const [index, svc] of data.newServices.entries()) {
    const id = `${SERVICE_ID_PREFIX}${svc.slug}`;
    const existing = await prisma.internationalService.findUnique({
      where: { slug: svc.slug },
      select: { id: true },
    });

    await prisma.internationalService.upsert({
      where: { slug: svc.slug },
      create: {
        id,
        slug: svc.slug,
        name: svc.name,
        nameFa: svc.nameFa,
        category: svc.category,
        descriptionFa: svc.descriptionFa,
        currency: 'USD',
        requiresManualReview: true,
        sortOrder: 100 + index,
      },
      update: { descriptionFa: svc.descriptionFa },
    });

    const serviceId = existing?.id ?? id;
    for (const field of fieldDefs(serviceId)) {
      await prisma.serviceFieldDefinition.upsert({
        where: { serviceId_key: { serviceId, key: field.key } },
        create: field,
        update: {},
      });
    }

    if (existing) {
      servicesUpdated += 1;
    } else {
      servicesCreated += 1;
    }
  }

  console.log(
    `[populate] brands updated: ${String(brandsUpdated)}, ` +
      `category services updated: ${String(categoriesUpdated)}, ` +
      `new services created: ${String(servicesCreated)}, ` +
      `new services updated: ${String(servicesUpdated)}`,
  );
}

function reportDryRun(data: CatalogDescriptions): void {
  console.log(
    `[populate] would update ${String(data.brandDescriptions.length)} brand(s), ` +
      `${String(data.categoryDescriptions.length)} category-level service(s), ` +
      `and upsert ${String(data.newServices.length)} new service(s):`,
  );
  for (const svc of data.newServices) {
    console.log(`  - [${svc.category}] ${svc.slug} — ${svc.nameFa}`);
  }
  console.log('[populate] DRY RUN — nothing written, no database connection opened.');
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const data = await loadData();

  if (dryRun) {
    reportDryRun(data);
    return;
  }

  // Imported here, not at the top: the module reads DATABASE_URL on load, and a
  // dry run has no business needing a database to tell you what it would do.
  const { createPrismaClient } = (await import('../src/client')) as {
    createPrismaClient: () => PrismaClient;
  };
  const prisma = createPrismaClient();
  try {
    await run(prisma, data);
  } finally {
    await prisma.$disconnect();
  }
}

if (/populate-catalog-descriptions\.[cm]?[jt]s$/u.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(`[populate] failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
