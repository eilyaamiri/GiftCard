/**
 * ============================================================================
 * RESELLCODES GIFT-CARD CATALOG IMPORT — real supplier data, imported switched off.
 * ============================================================================
 *
 * Turns the resell.codes gift-card catalogue into `Product` / `Sku` /
 * `SupplierOffer` rows, plus the provider-SKU map the `resellcodes` adapter
 * needs in order to buy them. It follows `import-reloadly-catalog.ts`:
 *
 *   - Every product and SKU is written `isActive: false`. Nothing it creates is
 *     visible to a customer, quotable or sellable until a person switches it on.
 *     The offer underneath is written active, so switching the SKU on is the
 *     single action needed; an offer under an inactive SKU cannot be reached.
 *   - Every row is NEW. A ReSellCodes product is never merged into, attached to
 *     or substituted for an existing product (a Reloadly one included), even
 *     when both are "Steam $10": ids carry their own prefix (`rsc_p_`, `rsc_s_`)
 *     and slugs their own `rsc-` prefix, so no existing row can be matched.
 *     Only the shared taxonomy (`Brand`, `Category`) is looked up and reused.
 *   - It never re-writes a row, its own included: `createMany({ skipDuplicates })`.
 *     A re-run adds what is new and leaves anything an operator changed alone.
 *
 * One `Product` per venue category (a brand, possibly per region), one `Sku`
 * per card in it. Provider SKU is `<category_id>:<card_id>`, the adapter's.
 *
 * The venue's shapes were inferred from documentation and are read tolerantly.
 * What is NOT in the feed, and is therefore a guess flagged for review:
 *
 *   - Face value. Cards carry only `name` and `price_usd` (our cost). The face
 *     value and its currency are read from the name ("Steam $10", "25 EUR");
 *     when the name gives none, the cost stands in, in USD, and the product is
 *     marked `needsReview`. Face value is a label — pricing uses the cost.
 *   - Region. Taken from the category or `/gift-cards/brands` when either
 *     carries one, otherwise `GLOBAL`.
 *
 * Money (AGENTS.md rule 2): `price_usd` is a decimal string and goes straight
 * into `Prisma.Decimal`; it never takes part in JS arithmetic.
 *
 * Usage:
 *   tsx prisma/import-resellcodes-catalog.ts --fetch [options]
 *   tsx prisma/import-resellcodes-catalog.ts --catalog=<raw.json> [options]
 *
 *   --save-raw=<file.json>   with --fetch: keep the venue's responses verbatim
 *   --review-out=<file.html> a page listing every product with its picture
 *   --map-out=<file.json>    write the provider-SKU map (SUPPLIER_PROVIDER_SKU_MAP_FILE)
 *   --dry-run                plan and report only; opens no database connection
 *
 * `--fetch` reads with RESELLCODES_API_KEY (GET requests only, never an order).
 * The key is never printed, and neither is any response body.
 * ============================================================================
 */

import { readFile, writeFile } from 'node:fs/promises';

import { Prisma } from '../generated/client';
import type { PrismaClient } from '../generated/client';
import { CATEGORIES, brandKey, brandSlug, classify } from './taxonomy';
import type { CategorySlug } from './taxonomy';

const SUPPLIER_CODE = 'resellcodes';

/** Every imported row carries one of these, so one prefix finds the import. */
const PRODUCT_ID_PREFIX = 'rsc_p_';
const SKU_ID_PREFIX = 'rsc_s_';

const MONEY_DP = 6;
const BATCH = 500;
const REPORT_LIMIT = 20;

/** 30 requests a minute is the venue's limit; one every 2.2 s stays under it. */
const REQUEST_GAP_MS = 2200;
const TIMEOUT_MS = 30_000;
const MAX_429_RETRIES = 5;
const MAX_NETWORK_RETRIES = 3;
const NETWORK_RETRY_WAIT_MS = 5_000;
/** The category list is one request; its `limit` is capped at 600 (default 200). */
const CATEGORY_LIMIT = 600;
/** Where the venue's relative picture paths live. */
const VENUE_ORIGIN = 'https://resell.codes';

type Json = Record<string, unknown>;

/** What `--fetch` saw, verbatim, and what `--catalog` reads back. */
export interface RawCatalog {
  /** Each page of `GET /gift-cards/categories`. */
  readonly categories: readonly unknown[];
  /** `category_id` -> each page of `GET /gift-cards/categories/{id}/cards`. */
  readonly cards: Readonly<Record<string, readonly unknown[]>>;
  /** Each page of `GET /gift-cards/brands`, or empty when it could not be read. */
  readonly brands: readonly unknown[];
}

interface PlannedProduct {
  readonly id: string;
  readonly slug: string;
  readonly brand: string;
  readonly title: string;
  readonly titleFa: string;
  readonly category: string;
  readonly categorySlug: CategorySlug;
  readonly imageUrl: string | null;
  readonly needsReview: boolean;
  readonly providerCategoryId: string;
}

interface PlannedSku {
  readonly skuId: string;
  readonly productRowId: string;
  readonly code: string;
  readonly region: string;
  readonly currency: string;
  readonly faceValue: Prisma.Decimal;
  readonly denominationLabel: string;
  readonly providerSku: string;
  readonly costAmount: Prisma.Decimal;
  readonly availability: string;
  readonly cardName: string;
  readonly imageUrl: string | null;
  readonly faceValueFromName: boolean;
}

export interface Plan {
  readonly products: readonly PlannedProduct[];
  readonly skus: readonly PlannedSku[];
  readonly skipped: readonly string[];
}

/* ========================================================================== */
/* Reading the venue's shapes                                                 */
/* ========================================================================== */

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === 'string' && value.trim() !== '') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

/** The rows of one page: the documented `data`, the adapter's `offers`, or a bare array. */
function rowsOf(page: unknown, keys: readonly string[]): Json[] {
  if (Array.isArray(page)) return page.filter(isObject);
  if (!isObject(page)) return [];
  for (const key of keys) {
    const value = page[key];
    if (Array.isArray(value)) return value.filter(isObject);
  }
  return [];
}

/**
 * Same rule as the adapter: https only, and of a sane length. The venue serves
 * its own pictures as a path (`/api/media/...`), which is made absolute against
 * the venue's own host; a path is never joined to any other origin.
 */
function imageOf(row: Json): string | null {
  for (const key of ['image', 'image_url', 'logo', 'logo_url']) {
    const raw = text(row[key]);
    if (raw === null) continue;
    const url = raw.startsWith('/') && !raw.startsWith('//') ? `${VENUE_ORIGIN}${raw}` : raw;
    if (url.startsWith('https://') && url.length <= 2048) return url;
  }
  return null;
}

function regionOf(value: unknown): string | null {
  const region = text(value)?.toUpperCase() ?? null;
  return region !== null && /^[A-Z]{2,12}$/u.test(region) ? region : null;
}

/** `category_id` -> region, from `/gift-cards/brands`, whichever of two shapes it has. */
function regionsFromBrands(pages: readonly unknown[]): Map<string, string> {
  const regions = new Map<string, string>();
  const take = (row: Json): void => {
    const id = text(row['category_id']);
    const region = regionOf(row['region']);
    if (id !== null && region !== null && !regions.has(id)) regions.set(id, region);
  };
  for (const page of pages) {
    for (const brand of rowsOf(page, ['data'])) {
      take(brand);
      const subcategories = brand['subcategories'];
      if (Array.isArray(subcategories)) subcategories.filter(isObject).forEach(take);
    }
  }
  return regions;
}

/* ========================================================================== */
/* Money                                                                      */
/* ========================================================================== */

/** The venue's amount string (up to 4 decimals) as a Decimal, never via a JS number. */
function costOf(value: unknown): Prisma.Decimal {
  const raw = typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '';
  if (!/^\d{1,12}(?:\.\d{1,6})?$/u.test(raw)) {
    throw new Error('price_usd is not a usable amount');
  }
  const decimal = new Prisma.Decimal(raw).toDecimalPlaces(MONEY_DP);
  if (decimal.lessThanOrEqualTo(0)) {
    throw new Error('price_usd is not positive');
  }
  return decimal;
}

const SYMBOLS: Readonly<Record<string, string>> = { $: 'USD', '€': 'EUR', '£': 'GBP', '₹': 'INR' };
const CODES = 'USD|EUR|GBP|CAD|AUD|TRY|AED|SAR|INR|BRL|MXN|PLN|CHF|SEK|NOK|DKK|JPY|CNY|HKD|SGD|NZD|ZAR|KWD|QAR|BHD|OMR|EGP|RUB|UAH|KZT|IDR|MYR|PHP|THB|KRW|TWD|ARS|CLP|COP|PEN|CZK|HUF|RON';
const AMOUNT = '(\\d{1,7}(?:[.,]\\d{1,2})?)';

/**
 * The face value a card's name states: "$10", "10$", "€25", "25 EUR", "USD 25".
 * Null when the name states none, or states two different ones.
 */
export function faceValueFromName(name: string): { amount: Prisma.Decimal; currency: string } | null {
  const patterns: [RegExp, (m: RegExpMatchArray) => [string, string]][] = [
    [new RegExp(`([$€£₹])\\s?${AMOUNT}`, 'gu'), (m) => [m[2] ?? '', SYMBOLS[m[1] ?? ''] ?? '']],
    [new RegExp(`${AMOUNT}\\s?([$€£₹])`, 'gu'), (m) => [m[1] ?? '', SYMBOLS[m[2] ?? ''] ?? '']],
    [new RegExp(`\\b${AMOUNT}\\s?(${CODES})\\b`, 'giu'), (m) => [m[1] ?? '', (m[2] ?? '').toUpperCase()]],
    [new RegExp(`\\b(${CODES})\\s?${AMOUNT}\\b`, 'giu'), (m) => [m[2] ?? '', (m[1] ?? '').toUpperCase()]],
  ];
  const found = new Map<string, { amount: Prisma.Decimal; currency: string }>();
  for (const [pattern, pick] of patterns) {
    for (const match of name.matchAll(pattern)) {
      const [amountText, currency] = pick(match);
      if (amountText === '' || currency === '') continue;
      const amount = new Prisma.Decimal(amountText.replace(',', '.')).toDecimalPlaces(MONEY_DP);
      if (amount.lessThanOrEqualTo(0)) continue;
      found.set(`${amount.toString()} ${currency}`, { amount, currency });
    }
  }
  return found.size === 1 ? ([...found.values()][0] ?? null) : null;
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
      .slice(0, 80) || 'card'
  );
}

/** A venue id made safe for our ids and SKU codes. */
function idPart(value: string): string {
  return value.replace(/[^A-Za-z0-9-]/gu, '_').slice(0, 60);
}

/* ========================================================================== */
/* Planning — pure                                                            */
/* ========================================================================== */

/**
 * The whole import, decided before a row is written. A card that cannot be
 * represented is skipped and named; it never aborts the rest.
 */
export function planImport(raw: RawCatalog): Plan {
  const products: PlannedProduct[] = [];
  const skus: PlannedSku[] = [];
  const skipped: string[] = [];
  const brandRegions = regionsFromBrands(raw.brands);
  const seenCategories = new Set<string>();

  const categories = raw.categories.flatMap((page) => rowsOf(page, ['data', 'categories']));
  for (const category of categories) {
    const categoryId = text(category['category_id']) ?? text(category['id']);
    if (categoryId === null || seenCategories.has(categoryId)) continue;
    seenCategories.add(categoryId);

    const name = text(category['name']) ?? categoryId;
    const brand = text(category['brand']) ?? name;
    const region = regionOf(category['region']) ?? brandRegions.get(categoryId) ?? 'GLOBAL';
    const productId = `${PRODUCT_ID_PREFIX}${idPart(categoryId)}`;
    const cards = (raw.cards[categoryId] ?? []).flatMap((page) => rowsOf(page, ['offers', 'data', 'cards']));

    const planned: PlannedSku[] = [];
    const seenCards = new Set<string>();
    const seenFaces = new Set<string>();
    for (const card of cards) {
      const cardId = text(card['card_id']) ?? text(card['id']);
      const cardName = text(card['name']) ?? cardId ?? '';
      if (cardId === null) {
        skipped.push(`${categoryId} "${cardName}": no card_id`);
        continue;
      }
      if (seenCards.has(cardId)) continue;
      seenCards.add(cardId);

      let cost: Prisma.Decimal;
      try {
        cost = costOf(card['price_usd']);
      } catch (error) {
        skipped.push(`${categoryId}:${cardId} "${cardName}": ${(error as Error).message}`);
        continue;
      }
      const stated = faceValueFromName(cardName);
      const faceValue = stated?.amount ?? cost;
      const currency = stated?.currency ?? 'USD';
      // `@@unique([productId, region, faceValue, currency])`: two cards that read
      // as the same face value cannot both be SKUs of one product.
      const face = `${faceValue.toString()} ${currency}`;
      if (seenFaces.has(face)) {
        skipped.push(`${categoryId}:${cardId} "${cardName}": same face value (${face}) as another card in this category`);
        continue;
      }
      seenFaces.add(face);

      const stock = card['stock'];
      planned.push({
        skuId: `${SKU_ID_PREFIX}${idPart(categoryId)}_${idPart(cardId)}`,
        productRowId: productId,
        code: `RSC-${idPart(categoryId)}-${idPart(cardId)}`,
        region,
        currency,
        faceValue,
        denominationLabel: stated !== null ? `${faceValue.toString()} ${currency}` : cardName.slice(0, 120),
        providerSku: `${categoryId}:${cardId}`,
        costAmount: cost,
        /* A missing stock figure is not "sold out"; the adapter re-checks before buying. */
        availability: typeof stock === 'number' && stock <= 0 ? 'UNAVAILABLE' : 'AVAILABLE',
        cardName,
        imageUrl: imageOf(card),
        faceValueFromName: stated !== null,
      });
    }

    if (planned.length === 0) {
      skipped.push(`${categoryId} "${name}": no usable card`);
      continue;
    }

    const imageUrl = imageOf(category) ?? planned.find((sku) => sku.imageUrl !== null)?.imageUrl ?? null;
    const categorySlug = classify(brand, name, text(category['type']) ?? 'Gift Cards');
    products.push({
      id: productId,
      slug: `rsc-${slugify(name)}-${idPart(categoryId).toLowerCase()}`.slice(0, 120),
      brand,
      title: name,
      titleFa: `گیفت کارت ${name}`,
      category: 'ReSellCodes',
      categorySlug,
      imageUrl,
      needsReview: imageUrl === null || categorySlug === 'other' || planned.some((sku) => !sku.faceValueFromName),
      providerCategoryId: categoryId,
    });
    skus.push(...planned);
  }

  return { products, skus, skipped };
}

/* ========================================================================== */
/* Fetching — GET only                                                        */
/* ========================================================================== */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCatalog(): Promise<RawCatalog> {
  const apiKey = process.env['RESELLCODES_API_KEY'];
  if (!apiKey) {
    throw new Error('--fetch needs RESELLCODES_API_KEY');
  }
  const base = (process.env['RESELLCODES_BASE_URL'] ?? 'https://resell.codes/api/v1').replace(/\/+$/u, '');
  let lastAt = 0;

  /**
   * One GET. A timeout or a dropped connection is retried (a GET changes
   * nothing), because a single slow answer in a twenty-minute read must not
   * throw the whole read away. Status 0 means every attempt failed.
   */
  const get = async (path: string): Promise<{ status: number; body: unknown }> => {
    for (let attempt = 0; ; attempt += 1) {
      const wait = lastAt + REQUEST_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastAt = Date.now();
      let response: Response;
      try {
        response = await fetch(`${base}${path}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        if (attempt >= MAX_NETWORK_RETRIES) return { status: 0, body: null };
        await sleep(NETWORK_RETRY_WAIT_MS * (attempt + 1));
        continue;
      }
      if (response.status === 429 && attempt < MAX_429_RETRIES) {
        const seconds = Number(response.headers.get('retry-after'));
        await sleep((Number.isFinite(seconds) && seconds > 0 ? seconds : 30) * 1000);
        continue;
      }
      // Only the status is ever reported; a body is data, never logged.
      const body: unknown = await response.json().catch(() => null);
      return { status: response.status, body };
    }
  };

  /*
   * None of the three catalogue endpoints has a cursor: the list is capped by
   * `limit` and reports its `total`. One request each; the result keeps the
   * `pages` shape the planner and `--catalog` files already use.
   */
  const pages = async (path: string): Promise<{ status: number; pages: unknown[] }> => {
    const { status, body } = await get(path);
    return { status, pages: status === 200 ? [body] : [] };
  };

  const categories = await pages(`/gift-cards/categories?limit=${String(CATEGORY_LIMIT)}`);
  if (categories.status !== 200) {
    throw new Error(`GET /gift-cards/categories answered ${String(categories.status)}`);
  }
  const first = categories.pages[0];
  const total = isObject(first) && typeof first['total'] === 'number' ? first['total'] : null;
  const received = categories.pages.flatMap((page) => rowsOf(page, ['data', 'categories'])).length;
  if (total !== null && received < total) {
    throw new Error(`the venue lists ${String(total)} categories but returned ${String(received)}; refusing a partial import`);
  }
  const brands = await pages('/gift-cards/brands');
  if (brands.status !== 200) {
    console.log(`[import] /gift-cards/brands answered ${String(brands.status)}; regions default to GLOBAL`);
  }

  const ids = categories.pages
    .flatMap((page) => rowsOf(page, ['data', 'categories']))
    .map((row) => text(row['category_id']) ?? text(row['id']))
    .filter((id): id is string => id !== null);
  console.log(`[import] ${String(ids.length)} categories; ~${String(Math.ceil((ids.length * REQUEST_GAP_MS) / 60_000))} min at the venue's rate limit`);

  const cards: Record<string, unknown[]> = {};
  const unreachable: string[] = [];
  for (const [index, id] of ids.entries()) {
    const result = await pages(`/gift-cards/categories/${encodeURIComponent(id)}/cards`);
    cards[id] = result.pages;
    if (result.status === 0) unreachable.push(id);
    const count = result.pages.flatMap((page) => rowsOf(page, ['offers', 'data', 'cards'])).length;
    const outcome = result.status === 200 ? `${String(count)} cards` : result.status === 0 ? 'no answer (timeout/network)' : `HTTP ${String(result.status)}`;
    console.log(`[import] [${String(index + 1)}/${String(ids.length)}] ${id}: ${outcome}`);
  }
  if (unreachable.length > 0) {
    console.log(`[import] WARNING: ${String(unreachable.length)} categories never answered and are missing from this read: ${unreachable.join(', ')}. Run it again before importing.`);
  }

  return { categories: categories.pages, cards, brands: brands.status === 200 ? brands.pages : [] };
}

/* ========================================================================== */
/* Review page                                                                */
/* ========================================================================== */

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/gu, (c) => `&#${String(c.charCodeAt(0))};`);
}

function reviewPage(plan: Plan): string {
  const byProduct = new Map<string, PlannedSku[]>();
  for (const sku of plan.skus) byProduct.set(sku.productRowId, [...(byProduct.get(sku.productRowId) ?? []), sku]);
  const sections = plan.products.map((product) => {
    const rows = (byProduct.get(product.id) ?? [])
      .map(
        (sku) =>
          `<tr><td>${esc(sku.providerSku)}</td><td>${esc(sku.cardName)}</td><td>${esc(sku.denominationLabel)}${sku.faceValueFromName ? '' : ' ⚠'}</td><td>${esc(sku.region)}</td><td>${esc(sku.costAmount.toString())}</td><td>${esc(sku.availability)}</td></tr>`,
      )
      .join('');
    const image = product.imageUrl !== null ? `<img src="${esc(product.imageUrl)}" alt="" loading="lazy">` : '<div class="noimg">no image</div>';
    return `<section>${image}<div><h2>${esc(product.title)}</h2><p>${esc(product.slug)} · ${esc(product.categorySlug)}${product.needsReview ? ' · <b>needs review</b>' : ''}</p><table><tr><th>provider SKU</th><th>card</th><th>face value</th><th>region</th><th>cost USD</th><th>stock</th></tr>${rows}</table></div></section>`;
  });
  const skipped = plan.skipped.map((line) => `<li>${esc(line)}</li>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>ReSellCodes gift cards</title>
<style>body{font-family:system-ui,sans-serif;margin:24px}section{display:flex;gap:16px;border-bottom:1px solid #ddd;padding:12px 0}img,.noimg{width:120px;height:80px;object-fit:contain;flex:none;background:#f4f4f4}.noimg{display:grid;place-items:center;color:#999}table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ddd;padding:3px 6px;text-align:left}h2{margin:0}</style>
<h1>ReSellCodes: ${String(plan.products.length)} products, ${String(plan.skus.length)} cards (all inactive)</h1>
<p>⚠ = face value not stated in the card name; the cost stands in for it.</p>
${sections.join('\n')}
<h2>Skipped (${String(plan.skipped.length)})</h2><ul>${skipped}</ul>`;
}

/* ========================================================================== */
/* Writing                                                                    */
/* ========================================================================== */

async function chunked<T>(rows: readonly T[], run: (batch: T[]) => Promise<unknown>): Promise<void> {
  for (let index = 0; index < rows.length; index += BATCH) {
    await run(rows.slice(index, index + BATCH));
  }
}

async function storedIds(
  find: (ids: string[]) => Promise<readonly { id: string }[]>,
  ids: readonly string[],
): Promise<Set<string>> {
  const found = new Set<string>();
  await chunked(ids, async (batch) => {
    for (const row of await find(batch)) found.add(row.id);
  });
  return found;
}

async function resolveCategories(prisma: PrismaClient): Promise<Map<string, string>> {
  await prisma.category.createMany({
    data: CATEGORIES.map((category, index) => ({
      id: `cat_${category.slug}`,
      slug: category.slug,
      name: category.name,
      nameFa: category.nameFa,
      iconKey: category.iconKey,
      sortOrder: (index + 1) * 10,
    })),
    skipDuplicates: true,
  });
  const rows = await prisma.category.findMany({ select: { id: true, slug: true } });
  return new Map(rows.map((row) => [row.slug, row.id]));
}

/** Existing brands are reused by name (taxonomy, not products); new ones are created. */
async function resolveBrands(prisma: PrismaClient, products: readonly PlannedProduct[]): Promise<Map<string, string>> {
  const existing = await prisma.brand.findMany({ select: { id: true, name: true, slug: true } });
  const byKey = new Map(existing.map((row) => [brandKey(row.name), row.id]));
  const takenSlugs = new Set(existing.map((row) => row.slug));
  const created: { id: string; slug: string; name: string; nameFa: string }[] = [];
  for (const product of products) {
    const key = brandKey(product.brand);
    if (key === '' || byKey.has(key)) continue;
    let slug = brandSlug(product.brand);
    for (let attempt = 2; takenSlugs.has(slug); attempt += 1) slug = `${brandSlug(product.brand)}-${String(attempt)}`;
    takenSlugs.add(slug);
    const id = `brnd_${slug}`;
    byKey.set(key, id);
    created.push({ id, slug, name: product.brand, nameFa: product.brand });
  }
  await chunked(created, async (batch) => {
    await prisma.brand.createMany({ data: batch, skipDuplicates: true });
  });
  return byKey;
}

async function writeCatalog(prisma: PrismaClient, plan: Plan): Promise<void> {
  const supplier = await prisma.supplier.findUnique({ where: { code: SUPPLIER_CODE }, select: { id: true } });
  if (supplier === null) {
    throw new Error(`no supplier with code "${SUPPLIER_CODE}" — run the seed (it creates it inactive) first`);
  }

  const categories = await resolveCategories(prisma);
  const brands = await resolveBrands(prisma, plan.products);

  await chunked(plan.products, async (batch) => {
    await prisma.product.createMany({
      data: batch.map((product) => ({
        id: product.id,
        slug: product.slug,
        brand: product.brand,
        title: product.title,
        titleFa: product.titleFa,
        category: product.category,
        brandId: brands.get(brandKey(product.brand)) ?? null,
        categoryId: categories.get(product.categorySlug) ?? null,
        imageUrl: product.imageUrl,
        isActive: false,
        needsReview: product.needsReview,
      })),
      skipDuplicates: true,
    });
  });

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
        /* The order answer says CODE or CODE_PIN per asset; the delivered asset carries its own type. */
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
        costCurrency: 'USD',
        costAmount: sku.costAmount,
        discountBps: 0,
        availability: sku.availability,
        priority: 100,
        isActive: true,
      })),
      skipDuplicates: true,
    });
  });

  if (missing.length > 0) {
    console.log(`[import] ${String(missing.length)} product(s) did not land (slug taken?):`);
    for (const product of missing.slice(0, REPORT_LIMIT)) console.log(`  - ${product.id} ${product.slug}`);
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
  const guessed = plan.skus.filter((sku) => !sku.faceValueFromName).length;
  const noImage = plan.products.filter((product) => product.imageUrl === null).length;
  console.log(
    `[import] planned ${String(plan.products.length)} products, ${String(plan.skus.length)} skus/offers; ` +
      `${String(noImage)} product(s) without image, ${String(guessed)} sku(s) with face value not in the name`,
  );
  if (plan.skipped.length > 0) {
    console.log(`[import] skipped ${String(plan.skipped.length)}:`);
    for (const line of plan.skipped.slice(0, REPORT_LIMIT)) console.log(`  - ${line}`);
    if (plan.skipped.length > REPORT_LIMIT) console.log(`  ... and ${String(plan.skipped.length - REPORT_LIMIT)} more`);
  }
}

async function main(): Promise<void> {
  const catalogPath = argValue('catalog');
  const saveRaw = argValue('save-raw');
  const reviewOut = argValue('review-out');
  const mapOut = argValue('map-out');
  const dryRun = process.argv.includes('--dry-run');
  if (catalogPath === undefined && !process.argv.includes('--fetch')) {
    throw new Error('pass --fetch or --catalog=<raw.json>');
  }

  const raw: RawCatalog =
    catalogPath !== undefined ? (JSON.parse(await readFile(catalogPath, 'utf8')) as RawCatalog) : await fetchCatalog();
  if (saveRaw !== undefined && catalogPath === undefined) {
    await writeFile(saveRaw, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    console.log(`[import] raw catalogue -> ${saveRaw}`);
  }

  const plan = planImport(raw);
  report(plan);

  if (reviewOut !== undefined) {
    await writeFile(reviewOut, reviewPage(plan), 'utf8');
    console.log(`[import] review page -> ${reviewOut}`);
  }
  if (mapOut !== undefined) {
    const map: Record<string, string> = {};
    for (const sku of plan.skus) map[`${SUPPLIER_CODE}:${sku.skuId}`] = sku.providerSku;
    await writeFile(mapOut, `${JSON.stringify(map)}\n`, 'utf8');
    console.log(`[import] provider-sku map: ${String(Object.keys(map).length)} entries -> ${mapOut}`);
  }

  if (dryRun) {
    console.log('[import] DRY RUN — nothing written, no database connection opened.');
    return;
  }

  const { createPrismaClient } = (await import('../src/client')) as { createPrismaClient: () => PrismaClient };
  const prisma = createPrismaClient();
  try {
    await writeCatalog(prisma, plan);
    const [productCount, skuCount, offerCount, activeProducts, activeSkus] = await Promise.all([
      prisma.product.count({ where: { id: { startsWith: PRODUCT_ID_PREFIX } } }),
      prisma.sku.count({ where: { id: { startsWith: SKU_ID_PREFIX } } }),
      prisma.supplierOffer.count({ where: { skuId: { startsWith: SKU_ID_PREFIX } } }),
      prisma.product.count({ where: { id: { startsWith: PRODUCT_ID_PREFIX }, isActive: true } }),
      prisma.sku.count({ where: { id: { startsWith: SKU_ID_PREFIX }, isActive: true } }),
    ]);
    console.log(
      `[import] stored: ${String(productCount)} products, ${String(skuCount)} skus, ${String(offerCount)} offers. ` +
        `Active among them: ${String(activeProducts)} products, ${String(activeSkus)} skus.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (/import-resellcodes-catalog\.[cm]?[jt]s$/u.test(process.argv[1] ?? '')) {
  main().catch((error: unknown) => {
    console.error(`[import] failed: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
