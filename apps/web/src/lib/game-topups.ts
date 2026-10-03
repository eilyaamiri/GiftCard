import { api, ApiClientError } from "./api";
import {
  imageUrlOf as gameImageUrl,
  telegramProductOf,
  topUpGameDetailSchema,
  topUpGameSummarySchema,
  type TopUpField,
  type TopUpGameDetail,
  type TopUpGameSummary,
  type TopUpOffer,
} from "./telegram";
import { isSteamEntry } from "./steam";

/**
 * Game top-ups: charge the customer's own game account, read from the public
 * top-up catalogue.
 *
 * The catalogue carries every direct top-up, and Telegram Stars/Premium have a
 * storefront of their own at `/telegram`. This module is everything else — the
 * games. It does not know or ask which venue supplies a game: the public DTO
 * deliberately carries no supplier, and which supplier may list a top-up at all
 * is decided when the catalogue is written, not here.
 *
 * Nothing in this file prices anything. A game's offers are identified by id,
 * the account the customer types is sent beside it, and the quote the server
 * returns is the only payable number this flow ever shows.
 */

/* ============================================================================
 * Reads
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

/** A Telegram entry belongs to `/telegram`, never to the games shelf. */
export function isTelegramEntry(game: Pick<TopUpGameSummary, "slug" | "name" | "nameFa">): boolean {
  return telegramProductOf(game) !== null;
}

/** Steam is sold on its own page, `/steam`, never from the games shelf. */
function isDedicatedEntry(game: Pick<TopUpGameSummary, "slug" | "name" | "nameFa" | "brandName">): boolean {
  return isTelegramEntry(game) || isSteamEntry(game);
}

/**
 * Every game on sale, in catalogue order.
 *
 * Entries are parsed one by one rather than as a single array: one malformed
 * game must cost the shelf that game, not every game. An outage resolves to an
 * empty list — the page then says nothing is available, which is the truth.
 */
export async function listGameTopUps(): Promise<readonly TopUpGameSummary[]> {
  let payload: unknown;
  try {
    payload = await api.topUps();
  } catch (error) {
    if (error instanceof ApiClientError) return [];
    throw error;
  }
  return itemsFrom(payload).flatMap((item) => {
    const parsed = topUpGameSummarySchema.safeParse(item);
    return parsed.success && !isDedicatedEntry(parsed.data) ? [parsed.data] : [];
  });
}

export type GameTopUpLookup =
  | { readonly kind: "game"; readonly game: TopUpGameDetail; readonly offers: readonly TopUpOffer[] }
  | { readonly kind: "telegram" }
  | { readonly kind: "steam" }
  | { readonly kind: "missing" };

/**
 * One game's page data.
 *
 * `missing` covers a 404, a game with nothing currently on sale and a shape
 * the schema refuses alike: the API already answers «not purchasable» and
 * «does not exist» with the same 404, and the storefront should not tell them
 * apart either. `telegram` lets the page send the customer to the page that
 * actually sells it instead of rendering a generic form for it.
 */
export async function getGameTopUp(slug: string): Promise<GameTopUpLookup> {
  let payload: unknown;
  try {
    payload = await api.get<unknown>(`/api/catalog/top-ups/${encodeURIComponent(slug)}`);
  } catch (error) {
    if (error instanceof ApiClientError) return { kind: "missing" };
    throw error;
  }
  const body =
    typeof payload === "object" && payload !== null && "game" in payload
      ? (payload as { game: unknown }).game
      : payload;
  const parsed = topUpGameDetailSchema.safeParse(body);
  if (!parsed.success) return { kind: "missing" };
  const game: TopUpGameDetail = { ...parsed.data, fields: parsed.data.fields ?? [], offers: parsed.data.offers ?? [] };
  if (isTelegramEntry(game)) return { kind: "telegram" };
  if (isSteamEntry(game)) return { kind: "steam" };
  const offers = sortedAvailableOffers(game.offers ?? []);
  return offers.length === 0 ? { kind: "missing" } : { kind: "game", game, offers };
}

export function sortedAvailableOffers(offers: readonly TopUpOffer[]): readonly TopUpOffer[] {
  return offers
    .filter((offer) => offer.isAvailable !== false)
    .map((offer, index) => ({ offer, index }))
    /* Stable on ties: the API already orders by name within a sort order, and
     * re-sorting must not shuffle what it decided. */
    .sort((left, right) => (left.offer.sortOrder ?? 0) - (right.offer.sortOrder ?? 0) || left.index - right.index)
    .map(({ offer }) => offer);
}

/* ============================================================================
 * Search
 * ==========================================================================*/

/**
 * Folded for matching: case, Arabic/Persian letter variants, zero-width joiners
 * and digits all compare equal, because a customer types «كالاف» on one
 * keyboard and «کالاف» on another and means the same game.
 */
export function foldForSearch(value: string): string {
  return toAsciiDigits(value)
    .toLowerCase()
    .replace(/[\u200c-\u200f]/gu, "")
    .replace(/ك/gu, "ک")
    .replace(/[يى]/gu, "ی")
    .replace(/[\s\-_:.]+/gu, " ")
    .trim();
}

/** Every word of the query must appear in the game's names or brand. */
export function filterGames<T extends Pick<TopUpGameSummary, "name" | "nameFa" | "brandName">>(
  games: readonly T[],
  query: string,
): readonly T[] {
  const words = foldForSearch(query).split(" ").filter((word) => word !== "");
  if (words.length === 0) return games;
  return games.filter((game) => {
    const haystack = foldForSearch(`${game.name} ${game.nameFa ?? ""} ${game.brandName ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

/* ============================================================================
 * Presentation
 * ==========================================================================*/

/** The Persian name when the catalogue has one, otherwise the venue's own. */
export function gameTitle(game: Pick<TopUpGameSummary, "name" | "nameFa">): string {
  const fa = game.nameFa?.trim();
  return fa !== undefined && fa !== "" ? fa : game.name;
}

const REGION_LABELS: Readonly<Record<string, string>> = {
  GLOBAL: "جهانی",
  WORLDWIDE: "جهانی",
  WW: "جهانی",
  EU: "اروپا",
  EUROPE: "اروپا",
  US: "آمریکا",
  USA: "آمریکا",
  TR: "ترکیه",
  TURKEY: "ترکیه",
  ASIA: "آسیا",
  MENA: "خاورمیانه",
  ME: "خاورمیانه",
};

/**
 * A region label a customer can read, or the venue's own code when we have no
 * translation. Never dropped: the region decides whether a top-up works on the
 * customer's account, so an untranslated code is better than silence.
 */
export function regionLabel(region: string | null | undefined): string | null {
  const code = region?.trim();
  if (code === undefined || code === "") return null;
  return REGION_LABELS[code.toUpperCase()] ?? code;
}

/** The first letter of the venue's name, for a card without artwork. */
export function gameMonogram(game: Pick<TopUpGameSummary, "name">): string {
  return Array.from(game.name.trim())[0]?.toUpperCase() ?? "?";
}

/* ============================================================================
 * Account fields
 *
 * The client-side half of `validateTopUpAccountFields` in the API. It exists
 * only so a customer hears about a typo before a round trip; the API repeats
 * every check and remains the authority. The rules are the API's own, in the
 * same order, so the two cannot disagree about a value in a way that lets the
 * form pass something the server then refuses for a reason the form never
 * mentioned.
 * ==========================================================================*/

/** Mirrors the API's cap. */
export const MAX_ACCOUNT_VALUE_LENGTH = 256;

export type AccountFieldErrors = Readonly<Record<string, string>>;

function toAsciiDigits(value: string): string {
  return value
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660));
}

/**
 * The value as it will be sent: trimmed, and with Persian or Arabic digits
 * read as the same number — a player id typed on a Persian keyboard is still
 * that player id. Select values are left alone; they are the venue's own.
 */
export function normalizeAccountValue(field: Pick<TopUpField, "options">, raw: string): string {
  const trimmed = raw.trim();
  if (field.options !== null && field.options !== undefined && field.options.length > 0) return trimmed;
  return toAsciiDigits(trimmed);
}

/**
 * The venue's pattern, compiled the way the API compiles it: without a `u`
 * flag and without anchors we did not write, and ignored when it does not
 * compile — an unusable pattern must not block a legitimate purchase.
 */
function matchesVenuePattern(pattern: string, value: string): boolean {
  try {
    return new RegExp(pattern).test(value);
  } catch {
    return true;
  }
}

export function validateAccountFields(
  fields: readonly TopUpField[],
  values: Readonly<Record<string, string>>,
): AccountFieldErrors {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = normalizeAccountValue(field, values[field.key] ?? "");
    if (value === "") {
      if (field.isRequired) errors[field.key] = "این فیلد الزامی است";
      continue;
    }
    if (value.length > MAX_ACCOUNT_VALUE_LENGTH) {
      errors[field.key] = "مقدار وارد شده بیش از حد طولانی است";
      continue;
    }
    const options = field.options ?? [];
    if (options.length > 0 && !options.some((option) => option.value === value)) {
      errors[field.key] = "یکی از گزینه‌های فهرست را انتخاب کنید";
      continue;
    }
    if (field.validationRegex !== null && field.validationRegex !== undefined && !matchesVenuePattern(field.validationRegex, value)) {
      errors[field.key] = "قالب وارد شده درست نیست";
    }
  }
  return errors;
}

/**
 * Exactly the keys the game declared, with empty optional values left out.
 *
 * The API rejects a key the game did not ask for, so nothing the form holds
 * beyond the declared fields can leak into the request.
 */
export function buildAccountFields(
  fields: readonly TopUpField[],
  values: Readonly<Record<string, string>>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fields) {
    const value = normalizeAccountValue(field, values[field.key] ?? "");
    if (value !== "") result[field.key] = value;
  }
  return result;
}

/** The input a field renders as. Unknown types fall back to plain text. */
export function inputKindOf(field: Pick<TopUpField, "fieldType" | "options">): "select" | "email" | "number" | "text" {
  if (field.options !== null && field.options !== undefined && field.options.length > 0) return "select";
  const type = field.fieldType.toUpperCase();
  if (type === "EMAIL") return "email";
  if (type === "NUMBER") return "number";
  return "text";
}

export { gameImageUrl };
export type { TopUpField, TopUpGameDetail, TopUpGameSummary, TopUpOffer };
