/**
 * The non-rial leg of a price.
 *
 * A catalog is not denominated in dollars. A card can be worth GBP 25 or
 * JPY 10,000, and before the rial price can be computed that face value has to
 * become dollars — the only currency the pricing pair knows. This contract is
 * that first leg, and nothing else: it never sees a rial, a spread or an order
 * book.
 *
 * It is deliberately NOT `FxRateProvider`. That interface documents its rates as
 * "IRR per one unit of the pair's foreign currency" and carries buy/sell/mid,
 * which a published reference rate simply does not have. Widening it to mean two
 * different things depending on the pair is how a rate ends up applied in the
 * wrong direction.
 */

import { type FxProviderErrorCode } from './fx-rate-provider.interface';

/**
 * One currency's standing against the dollar, in the direction it was published.
 *
 * `unitsPerUsd` is how many units of `currency` one dollar buys — GBP `0.74756`,
 * JPY `147.09` — and it is stored exactly as the upstream said it. Inverting it
 * here to get "dollars per unit" would be more convenient and would bake a
 * rounding error into the stored number: at six decimals the reciprocal of a
 * JPY quote is wrong by about seven parts in a hundred thousand, which on a
 * JPY 10,000 card is real money in someone's pocket. Callers divide instead, at
 * whatever precision they are working in, and the figure we keep on file is the
 * figure the source actually published.
 */
export interface RawCrossRate {
  /** ISO 4217, upper case. */
  readonly currency: string;
  /** Decimal string, never a number — the same rule `RawFxRate` states. */
  readonly unitsPerUsd: string;
  /** The day the source dated the observation, `YYYY-MM-DD`. */
  readonly publishedOn: string;
  /** A category, as `FxRate.source` uses it: `API | SCRAPE | MANUAL`. */
  readonly source: string;
  /** When Barat Pay received the response. */
  readonly receivedAt: Date;
}

/**
 * A source of USD cross rates.
 *
 * The whole table is fetched at once because that is the shape these sources
 * publish in and the shape our catalog needs: a page of search results can span
 * a dozen currencies, and one request that answers all of them beats a dozen
 * that each answer one. `USD` itself is not expected in the table — it is the
 * base, its rate is 1 by definition, and no network call should be needed to
 * learn that.
 */
export interface CrossRateProvider {
  readonly name: string;
  getUsdTable(): Promise<readonly RawCrossRate[]>;
}

/** Reuses `FxProviderErrorCode`; a cross-rate feed fails in the same ways. */
export type CrossRateErrorCode = FxProviderErrorCode;

/** DI token. The FX module binds it; no domain module names an adapter class. */
export const FX_CROSS_RATE_PROVIDER = 'BARAT_FX_CROSS_RATE_PROVIDER';
