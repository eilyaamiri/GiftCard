/**
 * Money helper SIGNATURES.
 *
 * `packages/contracts` is a vocabulary, not a runtime library — it contains no
 * financial logic. The single implementation of these signatures lives in the
 * pricing workstream (`apps/api/src/modules/pricing/money`), which owns rule 2
 * and rule 4 and is covered by 100% unit tests.
 *
 * Declaring the shapes here means every consumer type-checks against the same
 * contract even before the implementation lands.
 */

import type {
  Bps,
  CurrencyCode,
  DecimalString,
  Irr,
  IrrString,
  RoundingMode,
  Toman,
  UsdAmount,
} from './types';

/* ============================================================================
 * Individual function signatures
 * ==========================================================================*/

/** Parse an untrusted value into `Irr`. Throws on a float, NaN or a decimal point. */
export type ToIrrFn = (value: bigint | number | string) => Irr;

/** IRR -> transport string. */
export type IrrToStringFn = (value: Irr) => IrrString;

/** Transport string -> IRR. Throws on a malformed string. */
export type IrrFromStringFn = (value: IrrString | string) => Irr;

/**
 * IRR -> Toman for display. Throws when the amount is not divisible by 10:
 * a silent truncation here is a real money loss.
 */
export type IrrToTomanFn = (value: Irr) => Toman;

/** Toman -> IRR. Always exact. */
export type TomanToIrrFn = (value: Toman) => Irr;

/**
 * Apply a basis-point rate to an IRR amount.
 * `applyBps(1_000_000n, 250)` === 25_000n (2.5%). Rounds per `mode`, default `HALF_UP`.
 */
export type ApplyBpsFn = (amount: Irr, bps: Bps, mode?: RoundingMode) => Irr;

/** Round an IRR amount UP to the nearest multiple of `stepIrr`. */
export type RoundUpToStepFn = (amount: Irr, stepIrr: Irr) => Irr;

/** Round an IRR amount to the nearest multiple of `stepIrr` using `mode`. */
export type RoundToStepFn = (amount: Irr, stepIrr: Irr, mode: RoundingMode) => Irr;

/**
 * Multiply a foreign-currency amount by an FX rate and return exact IRR.
 * Implemented with Decimal.js, never with `Number`.
 */
export type ForeignToIrrFn = (
  amount: UsdAmount | DecimalString,
  rate: DecimalString,
  mode?: RoundingMode,
) => Irr;

/** Add a bps spread to an FX rate, returning a new decimal string. */
export type ApplyBpsToRateFn = (rate: DecimalString, bps: Bps) => DecimalString;

/** Difference between two amounts expressed in basis points of `expected`. */
export type VarianceBpsFn = (expected: Irr, actual: Irr) => Bps;

/** Sum a list of IRR amounts without intermediate precision loss. */
export type SumIrrFn = (amounts: readonly Irr[]) => Irr;

/** Format IRR for a Persian UI. Always emits an LTR-isolated numeric string. */
export type FormatTomanFn = (
  value: Irr,
  options?: { readonly withSuffix?: boolean; readonly locale?: 'fa' | 'en' },
) => string;

/** Convert a gateway wire amount back to IRR, rejecting non-divisible conversions. */
export type FromGatewayAmountFn = (amount: string | number, unit: 'IRR' | 'IRT') => Irr;

/** Convert IRR to the unit the gateway expects, rejecting non-divisible conversions. */
export type ToGatewayAmountFn = (amount: Irr, unit: 'IRR' | 'IRT') => string;

/* ============================================================================
 * The full helper surface
 * ==========================================================================*/

/**
 * The contract the pricing module must satisfy. Inject this rather than
 * importing loose functions, so tests can substitute a deterministic double.
 */
export interface MoneyHelpers {
  readonly toIrr: ToIrrFn;
  readonly irrToString: IrrToStringFn;
  readonly irrFromString: IrrFromStringFn;
  readonly irrToToman: IrrToTomanFn;
  readonly tomanToIrr: TomanToIrrFn;
  readonly applyBps: ApplyBpsFn;
  readonly roundUpToStep: RoundUpToStepFn;
  readonly roundToStep: RoundToStepFn;
  readonly foreignToIrr: ForeignToIrrFn;
  readonly applyBpsToRate: ApplyBpsToRateFn;
  readonly varianceBps: VarianceBpsFn;
  readonly sumIrr: SumIrrFn;
  readonly formatToman: FormatTomanFn;
  readonly fromGatewayAmount: FromGatewayAmountFn;
  readonly toGatewayAmount: ToGatewayAmountFn;
}

/** DI token name for `MoneyHelpers`. */
export const MONEY_HELPERS = 'BARAT_MONEY_HELPERS' as const;

/** Currency code constants used across the POC. */
export const CURRENCY_IRR = 'IRR' as CurrencyCode;
export const CURRENCY_USD = 'USD' as CurrencyCode;
