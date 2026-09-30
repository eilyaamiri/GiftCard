import { z } from "zod";
import { positiveDecimalStringSchema, positiveIrrStringSchema } from "@barat/contracts";
import { api, ApiClientError } from "./api";

/**
 * Telegram Stars and Premium, read from the public top-up catalog.
 *
 * `GET /api/catalog/top-ups` is still landing, so nothing here assumes a field
 * is present: the schemas are loose, the normalizers are defensive, and an
 * offer that arrives without a usable id is dropped rather than repaired.
 * Inventing an id would mean quoting something the customer never chose, and a
 * wrong id reaches the supplier as a real purchase.
 *
 * The two product kinds are told apart by the SKU Tail the supplier adapter
 * publishes (`telegram:stars:<quantity>` / `telegram:premium:<months>`), which
 * is part of the design doc and shared with the API — not by scraping display
 * names, and not by matching a fixed list of slugs the seed happens to use.
 */

/* ============================================================================
 * Contract
 * ==========================================================================*/

/** The supplier SKU prefix. Mirrors `telegram:*` in the adapter's own space. */
export const TELEGRAM_SKU_PREFIX = "telegram:";
export const STARS_SKU = `${TELEGRAM_SKU_PREFIX}stars`;
export const PREMIUM_SKU = `${TELEGRAM_SKU_PREFIX}premium`;

/**
 * The account identifier both products are delivered to. This key is the wire
 * contract: it travels as `topUpAccountFields.telegram_username` on the quote
 * request, and the API validates it against the game's own `TopUpField` rows.
 */
export const TELEGRAM_USERNAME_KEY = "telegram_username";

const optionSchema = z.object({ label: z.string().min(1), value: z.string().min(1) });

export const topUpFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  labelFa: z.string().nullable().optional(),
  fieldType: z.string().min(1),
  isRequired: z.boolean(),
  options: z.array(optionSchema).nullable().optional(),
  validationRegex: z.string().nullable().optional(),
  helpTextFa: z.string().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type TopUpField = z.infer<typeof topUpFieldSchema>;

export const topUpOfferSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  nameFa: z.string().nullable().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  providerSku: z.string().nullable().optional(),
  sku: z.string().nullable().optional(),
  /** Indicative only — display, never a payable amount. A real quote decides. */
  indicativePriceIrr: positiveIrrStringSchema.nullable().optional(),
  indicativePriceToman: positiveIrrStringSchema.nullable().optional(),
  /** Supplier-side face value, e.g. `100` Stars or the amount in the offer name. */
  faceValue: positiveDecimalStringSchema.nullable().optional(),
});
export type TopUpOffer = z.infer<typeof topUpOfferSchema>;

export const topUpGameSummarySchema = z.object({
  id: z.string().min(1),
  slug: z.string().min(1),
  name: z.string().min(1),
  nameFa: z.string().nullable().optional(),
  brandName: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  offerCount: z.number().int().min(0).optional(),
});
export type TopUpGameSummary = z.infer<typeof topUpGameSummarySchema>;

export const topUpGameDetailSchema = topUpGameSummarySchema.extend({
  providerNote: z.string().nullable().optional(),
  descriptionFa: z.string().nullable().optional(),
  fields: z.array(topUpFieldSchema).optional(),
  offers: z.array(topUpOfferSchema).optional(),
});
export type TopUpGameDetail = z.infer<typeof topUpGameDetailSchema>;

/**
 * Which Telegram product a catalogue entry is.
 *
 * The SKU is authoritative. Without one, a game whose slug mentions telegram is
 * classified by the words in its own name and description — a guess, but a
 * guess confined to picking which of two pages shows the entry, never to the
 * price or the offer that gets quoted.
 */
export type TelegramProduct = "stars" | "premium";

function percentDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function telegramProductOf(input: {
  readonly slug: string;
  readonly name?: string | null;
  readonly nameFa?: string | null;
}): TelegramProduct | null {
  /* Decoded first: a slug carries `telegram%3Astars%3A100`, and matching on the
   * encoded text would classify nothing. */
  const haystack = `${percentDecode(input.slug)} ${input.name ?? ""} ${input.nameFa ?? ""}`.toLowerCase();
  if (!haystack.includes(TELEGRAM_SKU_PREFIX) && !haystack.includes("telegram") && !haystack.includes("تلگرام")) {
    return null;
  }
  return /premium|پرمیوم|پریمیوم/.test(haystack) ? "premium" : "stars";
}

/** A product the storefront is willing to offer, and which offers back it. */
export interface TelegramCatalogEntry {
  readonly product: TelegramProduct;
  readonly game: TopUpGameDetail;
  readonly offers: readonly TopUpOffer[];
}

function detailOf(entry: z.infer<typeof topUpGameDetailSchema>): TopUpGameDetail {
  return { ...entry, fields: entry.fields ?? [], offers: entry.offers ?? [] };
}

/**
 * The first usable key for the Telegram username, derived from what the API
 * actually published and falling back to the documented one.
 *
 * Never invented: if the game publishes different account fields, the customer
 * must be asked for those instead, because the API validates unknown keys away.
 */
export function usernameFieldKey(entry: { readonly fields: readonly TopUpField[] }): string {
  const match = entry.fields.find((field) => field.isRequired) ?? entry.fields[0];
  return match?.key ?? TELEGRAM_USERNAME_KEY;
}

/* ============================================================================
 * Reads
 *
 * Both live server-side (the catalog is public but the pages render on the
 * server and hand values to client components), so an outage resolves to an
 * empty/unavailable state instead of an error page.
 * ==========================================================================*/

/** The list route's envelope, tolerating a bare array from an older revision. */
function itemsFrom(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (typeof payload === "object" && payload !== null) {
    const items = (payload as Record<string, unknown>)["items"];
    if (Array.isArray(items)) return items;
  }
  return [];
}

export async function listTelegramGames(): Promise<readonly TopUpGameSummary[]> {
  const summaries = z.array(topUpGameSummarySchema).safeParse(itemsFrom(await api.topUps()));
  if (!summaries.success) return [];
  return summaries.data.filter((game) => telegramProductOf(game) !== null);
}

/**
 * One product's page data.
 *
 * `slug` is the catalogue's own slug when the caller knows it; otherwise the
 * product is located in the list first. An entry with no offers is treated as
 * an entry that is not for sale yet — the page says so rather than rendering an
 * empty picker.
 */
export async function getTelegramProduct(
  product: TelegramProduct,
  slug?: string,
): Promise<TelegramCatalogEntry | null> {
  const candidates = slug !== undefined ? [slug] : await slugsFor(product);
  for (const candidate of candidates) {
    const entry = await detail(candidate);
    if (entry === null) continue;
    if (telegramProductOf({ slug: entry.slug, name: entry.name, nameFa: entry.nameFa }) !== product) continue;
    const offers = (entry.offers ?? [])
      .filter((offer) => offer.isAvailable !== false)
      .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
    if (offers.length === 0) continue;
    return { product, game: entry, offers };
  }
  return null;
}

async function slugsFor(product: TelegramProduct): Promise<readonly string[]> {
  return (await listTelegramGames())
    .filter((game) => telegramProductOf(game) === product)
    .map((game) => game.slug);
}

async function detail(slug: string): Promise<TopUpGameDetail | null> {
  try {
    const payload = await api.get<unknown>(`/api/catalog/top-ups/${encodeURIComponent(slug)}`);
    const body =
      typeof payload === "object" && payload !== null && "game" in payload
        ? (payload as { game: unknown }).game
        : payload;
    const parsed = topUpGameDetailSchema.safeParse(body);
    return parsed.success ? detailOf(parsed.data) : null;
  } catch (error) {
    /* A 404 is the route saying «no such game», which is an ordinary miss while
     * the caller walks a candidate list. Anything else — an outage, a shape the
     * schema refuses — is also not worth taking the page down for: the customer
     * gets the unavailable state, which is the truth. */
    if (error instanceof ApiClientError || error instanceof z.ZodError) return null;
    throw error;
  }
}

/* ============================================================================
 * Presentation helpers
 * ==========================================================================*/

/**
 * The Stars count or Premium month count an offer stands for.
 *
 * Read from the offer's own face value, then its SKU, then the first integer in
 * its name — «۱۰۰ استارز» and «100 Stars» both give 100. `null` means the ladder
 * position is unknown, and the UI then shows the supplier's name as-is instead
 * of a number it made up.
 */
export function offerQuantity(offer: TopUpOffer): number | null {
  if (offer.faceValue !== null && offer.faceValue !== undefined) {
    const value = Number(offer.faceValue);
    if (Number.isInteger(value) && value > 0) return value;
  }
  const sku = offer.providerSku ?? offer.sku ?? "";
  if (sku.startsWith(`${STARS_SKU}:`) || sku.startsWith(`${PREMIUM_SKU}:`)) {
    const value = Number(sku.slice(sku.lastIndexOf(":") + 1));
    if (Number.isInteger(value) && value > 0) return value;
  }
  const match = /\d+/u.exec(offer.name.replace(/[۰-۹]/gu, persianDigitsToAscii));
  const value = match === null ? Number.NaN : Number(match[0]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/** «۵۰ استارز» / «۳ ماه پرمیوم» — only when the quantity is actually known. */
export function offerLabel(product: TelegramProduct, offer: TopUpOffer, quantity: number | null): string {
  if (offer.nameFa !== null && offer.nameFa !== undefined && offer.nameFa.trim() !== "") return offer.nameFa;
  if (quantity === null) return offer.name;
  return product === "stars"
    ? `${quantity.toLocaleString("fa-IR")} استارز`
    : `${quantity.toLocaleString("fa-IR")} ماه پرمیوم`;
}

function persianDigitsToAscii(digit: string): string {
  return String(digit.charCodeAt(0) - 0x06f0);
}

/**
 * Read in both directions, because a customer will type either.
 *
 * The supplier documents `@` as optional and publishes no validation rule, and
 * the API validates the field against whatever the game declares. The check
 * here is only «not obviously wrong»: a missing `@` and a Persian keyboard's
 * digits are corrected rather than refused.
 */
export function normalizeUsername(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/[۰-۹]/gu, persianDigitsToAscii)
    .replace(/^@+/u, "");
  return trimmed === "" ? "" : `@${trimmed}`;
}

/** The venue documents only a non-empty string; do not invent stricter rules. */
export function isValidUsername(raw: string): boolean {
  return normalizeUsername(raw) !== "";
}

/** Where a catalogue entry's own image lives, or `null` when it published none. */
export function imageUrlOf(game: TopUpGameSummary): string | null {
  const url = game.imageUrl?.trim();
  return url !== undefined && url !== "" ? url : null;
}
