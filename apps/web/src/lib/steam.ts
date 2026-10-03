import { z } from "zod";
import { api } from "./api";
import {
  detail,
  itemsFrom,
  percentDecode,
  persianDigitsToAscii,
  topUpGameSummarySchema,
  type TopUpField,
  type TopUpGameDetail,
  type TopUpGameSummary,
  type TopUpOffer,
} from "./telegram";

/**
 * Steam wallet top-up, read from the public top-up catalogue.
 *
 * The venue sells any USD amount, so the catalogue holds ONE template offer and
 * the customer types the amount. Like Telegram it is told apart from the games
 * shelf by what the catalogue publishes about it, never by a hard-coded slug,
 * and the customer's price is always the server's quote — nothing here prices
 * anything. The bounds below only shape the input; the API enforces them.
 */

/** The wire key the API validates the Steam login against. */
export const STEAM_LOGIN_KEY = "steam_login";

/** Mirrors `STEAM_CUSTOM_*` in the API's topup-provider-sku.ts, in whole US cents. */
export const STEAM_MIN_USD_CENTS = 15n;
export const STEAM_MAX_USD_CENTS = 100_000n;

const STEAM_WORD = /(^|[^a-z])steam([^a-z]|$)/u;

export function isSteamEntry(input: {
  readonly slug: string;
  readonly name?: string | null;
  readonly nameFa?: string | null;
  readonly brandName?: string | null;
}): boolean {
  const haystack = `${percentDecode(input.slug)} ${input.name ?? ""} ${input.brandName ?? ""}`.toLowerCase();
  return STEAM_WORD.test(haystack) || (input.nameFa ?? "").includes("استیم");
}

export interface SteamCatalogEntry {
  readonly game: TopUpGameDetail;
  /** The template offer the typed amount is bound to. */
  readonly offerId: string;
}

/** Steam's own login rules are looser than a username, so only «not empty, no spaces». */
export function normalizeSteamLogin(raw: string): string {
  return raw.trim().replace(/[۰-۹]/gu, persianDigitsToAscii);
}

export function isValidSteamLogin(raw: string): boolean {
  const login = normalizeSteamLogin(raw);
  return login !== "" && login.length <= 64 && /^[^\s\p{Cc}]+$/u.test(login);
}

export type SteamAmountResult =
  | { readonly ok: true; readonly amount: string }
  | { readonly ok: false; readonly reason: "REQUIRED" | "FORMAT" | "BELOW_MIN" | "ABOVE_MAX" };

/** Integer-cents parse of a typed USD amount (≤ 2 decimals); no float touches it. */
export function parseSteamUsdAmount(raw: string): SteamAmountResult {
  const text = raw.trim().replace(/[۰-۹]/gu, persianDigitsToAscii).replace(/٫/gu, ".");
  if (text === "") return { ok: false, reason: "REQUIRED" };
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/u.exec(text);
  if (match === null) return { ok: false, reason: "FORMAT" };
  const cents = BigInt(match[1] ?? "0") * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents < STEAM_MIN_USD_CENTS) return { ok: false, reason: "BELOW_MIN" };
  if (cents > STEAM_MAX_USD_CENTS) return { ok: false, reason: "ABOVE_MAX" };
  const fraction = (cents % 100n).toString().padStart(2, "0").replace(/0+$/u, "");
  const whole = (cents / 100n).toString();
  return { ok: true, amount: fraction === "" ? whole : `${whole}.${fraction}` };
}

/** The template offer: the one whose SKU ends in `:custom`, else the only buyable one. */
export function pickSteamTemplateOffer(offers: readonly TopUpOffer[]): TopUpOffer | undefined {
  const buyable = offers.filter((offer) => offer.isAvailable !== false);
  return (
    buyable.find((offer) => (offer.providerSku ?? offer.sku ?? "").endsWith(":custom")) ??
    (buyable.length === 1 ? buyable[0] : undefined)
  );
}

export async function listSteamGames(): Promise<readonly TopUpGameSummary[]> {
  const summaries = z.array(topUpGameSummarySchema).safeParse(itemsFrom(await api.topUps()));
  if (!summaries.success) return [];
  return summaries.data.filter(isSteamEntry);
}

/** The Steam wallet product, or `null` when the catalogue publishes nothing buyable for it. */
export async function getSteamTopUp(): Promise<SteamCatalogEntry | null> {
  for (const summary of await listSteamGames()) {
    const game = await detail(summary.slug);
    if (game === null || !isSteamEntry(game)) continue;
    const offer = pickSteamTemplateOffer(game.offers ?? []);
    if (offer !== undefined) return { game, offerId: offer.id };
  }
  return null;
}

export function steamLoginField(game: TopUpGameDetail): TopUpField | undefined {
  const fields = game.fields ?? [];
  return fields.find((field) => field.key === STEAM_LOGIN_KEY) ?? (fields.length === 1 ? fields[0] : undefined);
}
