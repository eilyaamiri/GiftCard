/**
 * Money primitives.
 *
 * AGENTS.md rules 2 and 3:
 *   - Iranian money is an integer number of RIAL, carried as `bigint`.
 *   - Foreign currency is a fixed-point decimal, carried as a decimal STRING at
 *     the boundary and as `Decimal.js` inside the pricing engine.
 *   - Rates and percentages are integer basis points.
 *
 * There is no `number` money type in this system. If you find yourself writing
 * `amount * 1.09` you are already wrong.
 */

/** Nominal typing helper. `Brand<string, 'X'>` is not assignable from a bare string. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/* ============================================================================
 * Iranian rial
 * ==========================================================================*/

/**
 * An integer amount of Iranian RIAL. Always non-negative for prices; signed only
 * for deltas and variances.
 *
 * Never JSON-serialisable directly — `JSON.stringify(1n)` throws. Cross the wire
 * as `IrrString`.
 */
export type Irr = bigint;

/**
 * An integer amount of TOMAN. Display only. 1 Toman = 10 IRR.
 * Branded so that a Toman value can never be silently passed where IRR is expected.
 */
export type Toman = Brand<bigint, 'Toman'>;

/** IRR encoded for transport/JSON: an optionally signed integer string, e.g. `"19200000"`. */
export type IrrString = Brand<string, 'IrrString'>;

/** The exact multiplier between the two Iranian units. Never inline the literal 10. */
export const IRR_PER_TOMAN = 10n;

/* ============================================================================
 * Basis points
 * ==========================================================================*/

/**
 * An integer basis point value. `100 bps = 1%`, `10_000 bps = 100%`.
 * Percentages are never stored or transported as floats.
 */
export type Bps = number;

/** 10_000 bps == 100%. Used as the denominator in every bps calculation. */
export const BPS_DENOMINATOR = 10_000;

/* ============================================================================
 * Foreign currency
 * ==========================================================================*/

/**
 * A fixed-point decimal carried as a string, matching Prisma `Decimal(18, 6)`.
 * Example: `"12.500000"`, `"1920000.000000"`.
 */
export type DecimalString = Brand<string, 'DecimalString'>;

/** A USD amount as a decimal string. */
export type UsdAmount = Brand<string, 'UsdAmount'>;

/** An FX rate (IRR per 1 unit of foreign currency) as a decimal string. */
export type FxRateValue = Brand<string, 'FxRateValue'>;

/** ISO-4217 currency code, e.g. `USD`, `EUR`, `IRR`. */
export type CurrencyCode = Brand<string, 'CurrencyCode'>;

/** Scale of every `Decimal` column in the database. */
export const DECIMAL_SCALE = 6;
/** Precision of every `Decimal` column in the database. */
export const DECIMAL_PRECISION = 18;

/* ============================================================================
 * Rounding
 * ==========================================================================*/

/**
 * Customer-facing prices are always rounded UP to `PricingRule.roundingStepIrr`.
 * Rounding down would silently eat margin.
 */
export const ROUNDING_MODES = ['UP', 'DOWN', 'HALF_UP'] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];
