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
 * Steam is one product with a ladder of USD amounts, delivered to a Steam
 * login. Like Telegram it is told apart from the games shelf by what the
 * catalogue publishes about it, never by a hard-coded slug, and the customer's
 * price is always the server's quote — nothing here prices anything.
 */

/** The wire key the API validates the Steam login against. */
export const STEAM_LOGIN_KEY = "steam_login";

/** The supplier's own SKU space: `steam:usd:<amount>`. */
export const STEAM_SKU_PREFIX = "steam:usd:";

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
  readonly offers: readonly SteamOffer[];
}

export interface SteamOffer {
  readonly id: string;
  /** Whole-or-fractional USD the wallet is credited with. */
  readonly usd: number;
  readonly label: string;
}

/** Steam's own login rules are looser than a username, so only «not empty, no spaces». */
export function normalizeSteamLogin(raw: string): string {
  return raw.trim().replace(/[۰-۹]/gu, persianDigitsToAscii);
}

export function isValidSteamLogin(raw: string): boolean {
  const login = normalizeSteamLogin(raw);
  return login !== "" && login.length <= 64 && /^[^\s\p{Cc}]+$/u.test(login);
}

/** The USD amount an offer stands for: face value, then SKU tail, then the name. */
export function offerUsd(offer: TopUpOffer): number | null {
  const positive = (value: number): number | null => (Number.isFinite(value) && value > 0 ? value : null);
  if (offer.faceValue !== null && offer.faceValue !== undefined) {
    const value = positive(Number(offer.faceValue));
    if (value !== null) return value;
  }
  const sku = offer.providerSku ?? offer.sku ?? "";
  if (sku.startsWith(STEAM_SKU_PREFIX)) {
    const value = positive(Number(sku.slice(STEAM_SKU_PREFIX.length)));
    if (value !== null) return value;
  }
  const match = /(\d+(?:\.\d+)?)/u.exec(offer.name.replace(/[۰-۹]/gu, persianDigitsToAscii));
  return match?.[1] === undefined ? null : positive(Number(match[1]));
}

export function formatUsd(usd: number): string {
  return `$${Number.isInteger(usd) ? usd.toString() : usd.toFixed(2)}`;
}

function toSteamOffers(offers: readonly TopUpOffer[]): readonly SteamOffer[] {
  const result: SteamOffer[] = [];
  for (const offer of offers) {
    if (offer.isAvailable === false) continue;
    const usd = offerUsd(offer);
    if (usd === null) continue;
    result.push({ id: offer.id, usd, label: formatUsd(usd) });
  }
  return result.sort((a, b) => a.usd - b.usd);
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
    const offers = toSteamOffers(game.offers ?? []);
    if (offers.length > 0) return { game, offers };
  }
  return null;
}

export function steamLoginField(game: TopUpGameDetail): TopUpField | undefined {
  const fields = game.fields ?? [];
  return fields.find((field) => field.key === STEAM_LOGIN_KEY) ?? (fields.length === 1 ? fields[0] : undefined);
}
