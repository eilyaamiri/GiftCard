/**
 * ============================================================================
 * RELOADLY CATALOG IMPORT — real supplier data, imported switched off.
 * ============================================================================
 *
 * Turns Reloadly's product catalog into `Product` / `Sku` / `SupplierOffer`
 * rows, plus the provider-SKU map the adapter needs in order to buy them.
 *
 * Unlike `seed.ts` this writes REAL supplier data and is meant to run against
 * production, so its guardrails point the other way:
 *
 *   - Every product and SKU is written `isActive: false`. Nothing it creates is
 *     visible to a customer, quotable, or sellable until a person switches it
 *     on, one row at a time. The supplier offer underneath is written active,
 *     so that switching the SKU on is the single action needed — an active
 *     offer under an inactive SKU can never be reached, because a quote only
 *     gets to an offer through an active SKU.
 *   - Ids are deterministic (`rlx_p_<productId>`, `rlx_s_<productId>_<denom>`),
 *     so a re-run duplicates nothing, and the whole import can be found — or
 *     removed — by prefix alone.
 *   - It never touches a row it did not create, and never re-writes one it did.
 *     `createMany({ skipDuplicates })`, not upsert: a row that already exists
 *     may have been switched on by an operator since, and a second run must not
 *     silently hide a product that is live.
 *
 * Money (AGENTS.md rule 2): costs are `Prisma.Decimal` throughout, built from
 * strings. Reloadly sends JSON numbers, so each one is stringified before it
 * becomes a Decimal and never takes part in a JS arithmetic expression.
 *
 * Usage:
 *   tsx prisma/import-reloadly-catalog.ts --catalog=<file.json> [options]
 *   tsx prisma/import-reloadly-catalog.ts --fetch [options]
 *
 *   --map-out=<file.json>  write the provider-SKU map (SUPPLIER_PROVIDER_SKU_MAP_FILE)
 *   --dry-run              plan and report only; opens no database connection
 *
 * `--fetch` reads the catalog straight from Reloadly using RELOADLY_CLIENT_ID /
 * RELOADLY_CLIENT_SECRET / RELOADLY_ENVIRONMENT. Neither credential is logged,
 * and neither is any response body that could echo one back.
 * ============================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';

import { Prisma } from '../generated/client';
import type { PrismaClient } from '../generated/client';

const SUPPLIER_CODE = 'reloadly';

/** Every imported row carries one of these, so one prefix finds the import. */
const PRODUCT_ID_PREFIX = 'rlx_p_';
const SKU_ID_PREFIX = 'rlx_s_';

/** `Sku.faceValue` is `Decimal(18,6)`; the provider SKU must agree with it. */
const MONEY_DP = 6;

/** Rows per statement. ~2.4k products and ~8k SKUs, so this is a few dozen. */
const BATCH = 500;

const REPORT_LIMIT = 20;

/** `GET /products` reports 12 pages of 200; the sweep is a backstop, not the source. */
const PAGE_SWEEP = 12;

export interface ReloadlyProduct {
  readonly productId: number;
  readonly productName: string;
  readonly status?: string;
  readonly denominationType?: string;
  readonly recipientCurrencyCode?: string;
  readonly senderCurrencyCode?: string;
  readonly minRecipientDenomination?: number | null;
  readonly fixedRecipientDenominations?: readonly number[] | null;
  readonly fixedRecipientToSenderDenominationsMap?: Record<string, number> | null;
  readonly recipientCurrencyToSenderCurrencyExchangeRate?: number | null;
  readonly discountPercentage?: number | null;
  readonly logoUrls?: readonly string[] | null;
  readonly brand?: { readonly brandName?: string } | null;
  readonly category?: { readonly name?: string } | null;
  readonly country?: { readonly isoName?: string; readonly name?: string } | null;
  readonly redeemInstruction?: { readonly concise?: string; readonly verbose?: string } | null;
}

interface PlannedProduct {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly title: string;
  readonly titleFa: string;
  readonly description: string | null;
  readonly category: string;
  readonly imageUrl: string | null;
}

/** One buyable (product, denomination) pair — a row of the ProviderSKUs sheet. */
interface PlannedSku {
  readonly skuId: string;
  readonly productRowId: string;
  readonly code: string;
  readonly region: string;
  readonly currency: string;
  readonly faceValue: Prisma.Decimal;
  readonly denominationLabel: string;
  readonly providerSku: string;
  readonly costCurrency: string;
  readonly costAmount: Prisma.Decimal;
  readonly discountBps: number;
  readonly availability: string;
}

export interface Plan {
  readonly products: readonly PlannedProduct[];
  readonly skus: readonly PlannedSku[];
  readonly skipped: readonly string[];
}

/* ========================================================================== */
/* Money                                                                      */
/* ========================================================================== */

/**
 * A JSON number turned into a Decimal without ever being arithmetic.
 *
 * Reloadly's encoder emits artifacts like `89.90000000000001`; rounding to the
 * column's six decimal places removes them. That is a display artifact, not a
 * price difference — six places is finer than any currency Reloadly sells in.
 */
function decimalOf(value: number | string | null | undefined, field: string): Prisma.Decimal {
  if (value === null || value === undefined) {
    throw new Error(`${field} is missing`);
  }
  const decimal = new Prisma.Decimal(String(value));
  if (!decimal.isFinite()) {
    throw new Error(`${field} is not a finite number`);
  }
  return decimal.toDecimalPlaces(MONEY_DP);
}

/**
 * `25`, `89.9` — trailing zeros trimmed, so it reads as the catalog prints it.
 *
 * Rounding already happened in `decimalOf`, which is the only way a number gets
 * into this script.
 */
function plain(decimal: Prisma.Decimal): string {
  return decimal.toString();
}

/**
 * What one card costs us, in the supplier's own currency.
 *
 * Reloadly states this outright for fixed-denomination products, in
 * `fixedRecipientToSenderDenominationsMap` — that map is what it will actually
 * charge, so it wins wherever it has an entry. Only a range product, which has
 * no per-denomination entry to state, falls back to the published rate.
 *
 * The discount is deliberately NOT applied here. It is recorded separately as
 * `discountBps`, so that what we pay and what we are given back stay two
 * visible numbers rather than one netted one nobody can audit later.
 */
function costFor(
  product: ReloadlyProduct,
  denomination: Prisma.Decimal,
  field: string,
): Prisma.Decimal {
  const map = product.fixedRecipientToSenderDenominationsMap;
  if (map) {
    // Reloadly keys this map by the denomination as it prints it: `25`, `25.0`.
    for (const [key, value] of Object.entries(map)) {
      if (decimalOf(key, `${field} denomination key`).equals(denomination)) {
        return decimalOf(value, `${field} sender price`);
      }
    }
  }

  const rate = product.recipientCurrencyToSenderCurrencyExchangeRate;
  if (rate === null || rate === undefined) {
    throw new Error(`${field} has neither a sender price nor an exchange rate`);
  }
  return denomination.times(decimalOf(rate, `${field} exchange rate`)).toDecimalPlaces(MONEY_DP);
}

/** A percentage like `7.5` as integer basis points (AGENTS.md rule 13). */
function bpsOf(percentage: number | null | undefined, field: string): number {
  if (percentage === null || percentage === undefined) {
    return 0;
  }
  return decimalOf(percentage, field).times(100).round().toNumber();
}

/* ========================================================================== */
/* Identity                                                                   */
/* ========================================================================== */

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 90) || 'product'
  );
}

/** `25` -> `25`, `89.9` -> `89_9`. An id still readable next to its SKU. */
function idFragment(denomination: Prisma.Decimal): string {
  return plain(denomination).replace('.', '_');
}

/* ========================================================================== */
/* Planning — pure, and the only place the catalog shape is interpreted       */
/* ========================================================================== */

/**
 * The denominations that become SKUs.
 *
 * A fixed-denomination product contributes every denomination it lists. A range
 * product contributes exactly one SKU, at its minimum, because a range has no
 * denominations of its own — deciding to sell a €50 card out of a €5–€90 range
 * is a pricing decision, and it belongs to whoever sets prices, not to an
 * import. The rest of the range is not lost: adding a SKU for it later is one
 * row, and the provider SKU that reaches it is `<productId>:<amount>`.
 */
function denominationsOf(product: ReloadlyProduct): Prisma.Decimal[] {
  const field = `product ${String(product.productId)}`;
  if (product.denominationType === 'FIXED') {
    const fixed = product.fixedRecipientDenominations ?? [];
    return fixed.map((value, index) => decimalOf(value, `${field} denomination #${String(index)}`));
  }
  const min = product.minRecipientDenomination;
  if (min === null || min === undefined) {
    return [];
  }
  return [decimalOf(min, `${field} minRecipientDenomination`)];
}

function planProduct(product: ReloadlyProduct): PlannedProduct {
  const name = product.productName.trim();
  const brand = product.brand?.brandName?.trim();
  const redeem =
    product.redeemInstruction?.verbose?.trim() ?? product.redeemInstruction?.concise?.trim();
  return {
    id: `${PRODUCT_ID_PREFIX}${String(product.productId)}`,
    // The provider id keeps the slug unique: Reloadly ships several distinct
    // products under the same name in the same country.
    slug: `${slugify(name)}-${String(product.productId)}`,
    brand: brand !== undefined && brand !== '' ? brand : name,
    title: name,
    /*
     * The brand is not translated — someone looking for an Amazon card looks
     * for "Amazon". Only the noun in front of it is Persian, which is how the
     * seeded catalog reads too. `descriptionFa` and `redemptionNotesFa` are
     * left empty rather than machine-translated: they are customer-facing
     * redemption instructions, and a wrong one costs a support ticket.
     */
    titleFa: `گیفت کارت ${name}`,
    description: redeem !== undefined && redeem !== '' ? redeem : null,
    category: product.category?.name?.trim() ?? 'Gift Cards',
    imageUrl: product.logoUrls?.[0] ?? null,
  };
}

function planSkus(product: ReloadlyProduct, planned: PlannedProduct): PlannedSku[] {
  const field = `product ${String(product.productId)}`;
  const region = product.country?.isoName?.trim().toUpperCase();
  const currency = product.recipientCurrencyCode?.trim().toUpperCase();
  const costCurrency = product.senderCurrencyCode?.trim().toUpperCase();
  if (region === undefined || region === '') {
    throw new Error('has no country');
  }
  if (
    currency === undefined ||
    currency === '' ||
    costCurrency === undefined ||
    costCurrency === ''
  ) {
    throw new Error('has no currency');
  }

  const discountBps = bpsOf(product.discountPercentage, `${field} discountPercentage`);
  /*
   * An inactive product still gets its rows, marked unavailable. Reloadly turns
   * products off and on again, and a row that already exists with the right
   * price is cheaper to re-check than one that has to be re-imported.
   */
  const availability = product.status === 'ACTIVE' ? 'AVAILABLE' : 'UNAVAILABLE';

  const skus: PlannedSku[] = [];
  const seen = new Set<string>();
  for (const denomination of denominationsOf(product)) {
    if (denomination.lessThanOrEqualTo(0)) {
      throw new Error('has a non-positive denomination');
    }
    const fragment = idFragment(denomination);
    // Reloadly occasionally lists one denomination twice (`25` and `25.0`), and
    // `@@unique([productId, region, faceValue, currency])` would reject both.
    if (seen.has(fragment)) {
      continue;
    }
    seen.add(fragment);

    skus.push({
      skuId: `${SKU_ID_PREFIX}${String(product.productId)}_${fragment}`,
      productRowId: planned.id,
      code: `RLX-${String(product.productId)}-${fragment}`,
      region,
      currency,
      faceValue: denomination,
      denominationLabel: `${plain(denomination)} ${currency}`,
      providerSku: `${String(product.productId)}:${plain(denomination)}`,
      costCurrency,
      costAmount: costFor(product, denomination, field),
      discountBps,
      availability,
    });
  }
  return skus;
}

/**
 * The whole import, decided before a single row is written.
 *
 * A product that cannot be represented is skipped and named, never guessed at
 * and never allowed to abort the other 2,395: a catalog this size will always
 * hold a few rows with a missing currency or an unpriced denomination.
 */
export function planImport(products: readonly ReloadlyProduct[]): Plan {
  const plannedProducts: PlannedProduct[] = [];
  const plannedSkus: PlannedSku[] = [];
  const skipped: string[] = [];
  const seenProducts = new Set<number>();

  for (const product of products) {
    /*
     * A product can arrive twice: it is listed under every country it sells in,
     * and `GET /products` repeats rows across its unsorted pages. The first
     * copy wins. Without this the counts this script reports would be inflated
     * — the writes are idempotent either way, but a number nobody can trust is
     * worse than no number.
     */
    if (seenProducts.has(product.productId)) {
      continue;
    }
    seenProducts.add(product.productId);

    const planned = planProduct(product);
    let skus: PlannedSku[];
    try {
      skus = planSkus(product, planned);
    } catch (error) {
      skipped.push(
        `${String(product.productId)} ${product.productName}: ${(error as Error).message}`,
      );
      continue;
    }
    if (skus.length === 0) {
      skipped.push(`${String(product.productId)} ${product.productName}: no usable denomination`);
      continue;
    }
    plannedProducts.push(planned);
    plannedSkus.push(...skus);
  }

  return { products: plannedProducts, skus: plannedSkus, skipped };
}

/* ========================================================================== */
/* Fetching                                                                   */
/* ========================================================================== */

async function fetchCatalog(): Promise<ReloadlyProduct[]> {
  const clientId = process.env['RELOADLY_CLIENT_ID'];
  const clientSecret = process.env['RELOADLY_CLIENT_SECRET'];
  if (!clientId || !clientSecret) {
    throw new Error('--fetch needs RELOADLY_CLIENT_ID and RELOADLY_CLIENT_SECRET');
  }
  const host =
    process.env['RELOADLY_ENVIRONMENT'] === 'sandbox'
      ? 'https://giftcards-sandbox.reloadly.com'
      : 'https://giftcards.reloadly.com';

  const auth = await fetch('https://auth.reloadly.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      audience: host,
    }),
  });
  if (!auth.ok) {
    // An auth error body can echo the credential back; only the status is safe.
    throw new Error(`Reloadly auth failed with status ${String(auth.status)}`);
  }
  const token = (await auth.json()) as { access_token?: string };
  if (!token.access_token) {
    throw new Error('Reloadly auth returned no token');
  }

  const authorized = {
    Authorization: `Bearer ${token.access_token}`,
    Accept: 'application/com.reloadly.giftcards-v1+json',
  };
  const get = async (path: string): Promise<unknown> => {
    const response = await fetch(`${host}${path}`, { headers: authorized });
    if (!response.ok) {
      throw new Error(`Reloadly ${path} failed with status ${String(response.status)}`);
    }
    return response.json();
  };

  /*
   * Country by country, NOT `GET /products?page=`.
   *
   * The paged endpoint reports `"sort": {"unsorted": true}`, and it means it:
   * successive pages overlap and drop rows, so walking all 12 pages returns
   * 2,396 rows containing only ~1,467 distinct products. `/countries/{iso}/
   * products` is an unpaginated list per country and is complete by
   * construction. The paged sweep still runs afterwards, purely to pick up
   * anything that belongs to no country; `setdefault` semantics mean it can
   * only add, never overwrite a country's own copy.
   */
  const countries = (await get('/countries')) as readonly { isoName?: string }[];
  const byId = new Map<number, ReloadlyProduct>();

  for (const country of countries) {
    const iso = country.isoName;
    if (iso === undefined || iso === '') {
      continue;
    }
    const items = (await get(`/countries/${iso}/products`)) as readonly ReloadlyProduct[];
    for (const item of items) {
      byId.set(item.productId, item);
    }
    console.log(`[import] ${iso}: ${String(items.length)} products, ${String(byId.size)} so far`);
  }

  for (let page = 1; page <= PAGE_SWEEP; page += 1) {
    const body = (await get(`/products?size=200&page=${String(page)}`)) as {
      content?: ReloadlyProduct[];
      totalElements?: number;
    };
    for (const item of body.content ?? []) {
      if (!byId.has(item.productId)) {
        byId.set(item.productId, item);
      }
    }
    if (page === 1 && body.totalElements !== undefined) {
      console.log(`[import] Reloadly reports ${String(body.totalElements)} products in total`);
    }
  }

  return [...byId.values()].sort((left, right) => left.productId - right.productId);
}

/* ========================================================================== */
/* Writing                                                                    */
/* ========================================================================== */

async function chunked<T>(rows: readonly T[], run: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH) {
    await run(rows.slice(index, index + BATCH));
  }
}

/** Which of the ids we just tried to write are actually in the table now. */
async function storedIds(
  find: (ids: string[]) => Promise<readonly { id: string }[]>,
  ids: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  await chunked(ids, async (batch) => {
    for (const row of await find(batch)) {
      found.add(row.id);
    }
  });
  return found;
}

async function writeCatalog(prisma: PrismaClient, plan: Plan): Promise<void> {
  const supplier = await prisma.supplier.findUnique({
    where: { code: SUPPLIER_CODE },
    select: { id: true },
  });
  if (supplier === null) {
    throw new Error(`no supplier with code "${SUPPLIER_CODE}" — create it before importing`);
  }

  await chunked(plan.products, async (batch) => {
    await prisma.product.createMany({
      data: batch.map((product) => ({
        id: product.id,
        slug: product.slug,
        brand: product.brand,
        title: product.title,
        titleFa: product.titleFa,
        description: product.description,
        category: product.category,
        imageUrl: product.imageUrl,
        isActive: false,
      })),
      skipDuplicates: true,
    });
  });

  /*
   * `skipDuplicates` swallows a slug collision with a pre-existing product, and
   * a SKU pointing at a product that was never written is a foreign-key error
   * that would abort the batch it lands in. So the SKUs are narrowed to the
   * products demonstrably in the table, and whatever that drops is named.
   */
  const products = await storedIds(
    (ids) => prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    plan.products.map((product) => product.id),
  );
  const missing = plan.products.filter((product) => !products.has(product.id));
  const skus = plan.skus.filter((sku) => products.has(sku.productRowId));

  await chunked(skus, async (batch) => {
    await prisma.sku.createMany({
      data: batch.map((sku) => ({
        id: sku.skuId,
        productId: sku.productRowId,
        code: sku.code,
        region: sku.region,
        currency: sku.currency,
        faceValue: sku.faceValue,
        denominationLabel: sku.denominationLabel,
        /*
         * Reloadly's catalog says nothing about whether a given product returns
         * a PIN alongside the code, so every SKU is imported as the plain CODE
         * the schema defaults to. Nothing downstream depends on the guess: the
         * delivered asset carries its own type, and the request path already
         * takes the kind from what arrived rather than from what was predicted.
         */
        deliveryAssetType: 'CODE' as const,
        isActive: false,
      })),
      skipDuplicates: true,
    });
  });

  const stored = await storedIds(
    (ids) => prisma.sku.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    skus.map((sku) => sku.skuId),
  );
  const offers = skus.filter((sku) => stored.has(sku.skuId));

  await chunked(offers, async (batch) => {
    await prisma.supplierOffer.createMany({
      data: batch.map((sku) => ({
        supplierId: supplier.id,
        skuId: sku.skuId,
        costCurrency: sku.costCurrency,
        costAmount: sku.costAmount,
        discountBps: sku.discountBps,
        availability: sku.availability,
        priority: 100,
        /*
         * Active, underneath an inactive SKU. Nothing can be quoted through it
         * until someone switches the SKU on, and the moment they do it works —
         * which is the whole reason the offer is imported alongside the SKU.
         */
        isActive: true,
      })),
      skipDuplicates: true,
    });
  });

  if (missing.length > 0) {
    console.log(`[import] ${String(missing.length)} product(s) did not land (slug taken?):`);
    for (const product of missing.slice(0, REPORT_LIMIT)) {
      console.log(`  - ${product.id} ${product.slug}`);
    }
  }
}

/* ========================================================================== */
/* Entry point                                                                */
/* ========================================================================== */

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function report(plan: Plan): void {
  console.log(
    `[import] planned ${String(plan.products.length)} products, ` +
      `${String(plan.skus.length)} skus, ${String(plan.skus.length)} offers`,
  );
  if (plan.skipped.length > 0) {
    console.log(`[import] skipped ${String(plan.skipped.length)} product(s):`);
    for (const line of plan.skipped.slice(0, REPORT_LIMIT)) {
      console.log(`  - ${line}`);
    }
    if (plan.skipped.length > REPORT_LIMIT) {
      console.log(`  ... and ${String(plan.skipped.length - REPORT_LIMIT)} more`);
    }
  }
}

async function main(): Promise<void> {
  const catalogPath = argValue('catalog');
  const mapOut = argValue('map-out');
  const dryRun = process.argv.includes('--dry-run');

  const products: ReloadlyProduct[] = catalogPath
    ? (JSON.parse(await readFile(catalogPath, 'utf8')) as ReloadlyProduct[])
    : await fetchCatalog();
  console.log(`[import] catalog: ${String(products.length)} products`);

  const plan = planImport(products);
  report(plan);

  if (mapOut !== undefined) {
    const map: Record<string, string> = {};
    for (const sku of plan.skus) {
      map[`${SUPPLIER_CODE}:${sku.skuId}`] = sku.providerSku;
    }
    await writeFile(mapOut, `${JSON.stringify(map)}\n`, 'utf8');
    console.log(
      `[import] provider-sku map: ${String(Object.keys(map).length)} entries -> ${mapOut}`,
    );
  }

  if (dryRun) {
    console.log('[import] DRY RUN — nothing written, no database connection opened.');
    return;
  }

  // Imported here, not at the top: the module reads DATABASE_URL on load, and a
  // dry run has no business needing a database to tell you what it would do.
  const { createPrismaClient } = (await import('../src/client')) as {
    createPrismaClient: () => PrismaClient;
  };
  const prisma = createPrismaClient();

  try {
    await writeCatalog(prisma, plan);

    const [productCount, skuCount, offerCount, activeSkus] = await Promise.all([
      prisma.product.count({ where: { id: { startsWith: PRODUCT_ID_PREFIX } } }),
      prisma.sku.count({ where: { id: { startsWith: SKU_ID_PREFIX } } }),
      prisma.supplierOffer.count({ where: { skuId: { startsWith: SKU_ID_PREFIX } } }),
      prisma.sku.count({ where: { id: { startsWith: SKU_ID_PREFIX }, isActive: true } }),
    ]);
    console.log(
      `[import] stored: ${String(productCount)} products, ${String(skuCount)} skus, ` +
        `${String(offerCount)} offers. Active skus among them: ${String(activeSkus)}.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

/*
 * Only when invoked as a script. Importing this module — which the tests for
 * the planner above do — must not open a connection or write a row.
 */
if (/import-reloadly-catalog\.[cm]?[jt]s$/u.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(`[import] failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
