import Decimal from 'decimal.js';

import type { Bps, Irr, RoundingMode, Toman } from '@barat/contracts';
import { BPS_DENOMINATOR, DECIMAL_SCALE, IRR_PER_TOMAN } from '@barat/contracts';

/**
 * The money layer of Barat Pay.
 *
 * AGENTS.md rules 2, 3 and 13 live here and nowhere else:
 *   - Iranian money is an integer count of RIAL carried as `bigint`.
 *   - Foreign currency is `Decimal.js`, never `number`.
 *   - Percentages are integer basis points; 100 bps = 1%.
 *
 * There is not a single `+`, `*` or `/` on a JS float in this file. Every bps
 * application is exact integer arithmetic on bigint, and every FX multiplication
 * runs through a private 100-digit Decimal context. If you are about to write
 * `Number(amount)` anywhere near a price, stop.
 */

/**
 * A private high-precision Decimal constructor for financial calculations.
 *
 * Cloning rather than calling `Decimal.set` keeps the process-wide defaults
 * untouched, so an unrelated module that constructs a `Decimal` cannot change
 * how money is rounded here, and we cannot change it for them.
 */
const FinancialDecimal = Decimal.clone({
  precision: 100,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

/* ============================================================================
 * Guards
 * ==========================================================================*/

function assertIntegerBps(bps: Bps): void {
  if (!Number.isSafeInteger(bps)) {
    throw new RangeError('Basis points must be a safe integer');
  }
}

function assertPositiveStep(stepIrr: Irr): void {
  if (typeof stepIrr !== 'bigint') {
    throw new RangeError('Rounding step must be a bigint IRR amount');
  }
  if (stepIrr <= 0n) {
    throw new RangeError('Rounding step must be greater than zero IRR');
  }
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/* ============================================================================
 * IRR <-> Toman
 * ==========================================================================*/

/**
 * Convert an exact IRR amount to Toman for display.
 *
 * Throws when the amount is not exactly divisible by 10. Truncating here would
 * silently destroy up to 9 rial per conversion, which reconciliation would then
 * report as an unexplained variance months later. Callers that legitimately
 * produce a non-round amount must round the IRR first, explicitly, with
 * `roundUpToStep`.
 */
export function irrToToman(amountIrr: Irr): Toman {
  if (typeof amountIrr !== 'bigint') {
    throw new RangeError('IRR amount must be a bigint');
  }
  if (amountIrr % IRR_PER_TOMAN !== 0n) {
    throw new RangeError(
      `IRR amount ${amountIrr.toString()} is not exactly divisible by ${IRR_PER_TOMAN.toString()}`,
    );
  }

  return (amountIrr / IRR_PER_TOMAN) as Toman;
}

/** Convert an integer Toman amount to IRR. This multiplication is always exact. */
export function tomanToIrr(amountToman: Toman | bigint): Irr {
  if (typeof amountToman !== 'bigint') {
    throw new RangeError('Toman amount must be a bigint');
  }

  return amountToman * IRR_PER_TOMAN;
}

/* ============================================================================
 * Basis points
 * ==========================================================================*/

/**
 * Apply integer basis points to an IRR amount using integer arithmetic only.
 *
 * `applyBps(1_000_000n, 250)` === `25_000n` (2.5%).
 *
 * Rounding modes, all defined relative to ZERO so that a signed amount behaves
 * symmetrically (a fee on a refund must mirror the fee on the charge):
 *   - `HALF_UP` (default) — ties away from zero. The pricing default.
 *   - `UP`                — away from zero whenever there is any remainder.
 *   - `DOWN`              — toward zero (plain bigint truncation).
 */
export function applyBps(amount: Irr, bps: Bps, mode: RoundingMode = 'HALF_UP'): Irr {
  if (typeof amount !== 'bigint') {
    throw new RangeError('Amount must be a bigint IRR value');
  }
  assertIntegerBps(bps);

  const denominator = BigInt(BPS_DENOMINATOR);
  const numerator = amount * BigInt(bps);
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;

  if (remainder === 0n || mode === 'DOWN') {
    return quotient;
  }

  const direction = numerator < 0n ? -1n : 1n;
  if (mode === 'UP') {
    return quotient + direction;
  }

  if (mode !== 'HALF_UP') {
    throw new RangeError(`Unsupported rounding mode: ${String(mode)}`);
  }

  return absBigInt(remainder) * 2n >= denominator ? quotient + direction : quotient;
}

/**
 * Express `numerator / denominator` in basis points, rounded HALF_UP.
 *
 * Used only for derived, reported figures (effective margin, cost variance) —
 * never to compute an amount the customer pays.
 */
export function ratioToBps(numerator: bigint, denominator: bigint): Bps {
  if (typeof numerator !== 'bigint' || typeof denominator !== 'bigint') {
    throw new RangeError('Ratio operands must be bigint values');
  }
  if (denominator <= 0n) {
    throw new RangeError('Ratio denominator must be greater than zero');
  }

  const scaled = numerator * BigInt(BPS_DENOMINATOR);
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const direction = scaled < 0n ? -1n : 1n;
  const rounded = absBigInt(remainder) * 2n >= denominator ? quotient + direction : quotient;

  if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Derived basis-point value exceeds the safe integer range');
  }

  return Number(rounded);
}

/* ============================================================================
 * Rounding
 * ==========================================================================*/

/**
 * Round an IRR amount UP (toward positive infinity) to a multiple of `stepIrr`.
 *
 * Toward positive infinity rather than away from zero: the customer price is
 * always the ceiling, and rounding a negative adjustment away from zero would
 * hand back money we never charged.
 */
export function roundUpToStep(amount: Irr, stepIrr: Irr): Irr {
  if (typeof amount !== 'bigint') {
    throw new RangeError('Amount must be a bigint IRR value');
  }
  assertPositiveStep(stepIrr);

  const remainder = amount % stepIrr;
  if (remainder === 0n) {
    return amount;
  }

  return remainder > 0n ? amount + stepIrr - remainder : amount - remainder;
}

/** Round an IRR amount to a multiple of `stepIrr` using an explicit mode. */
export function roundToStep(amount: Irr, stepIrr: Irr, mode: RoundingMode): Irr {
  if (typeof amount !== 'bigint') {
    throw new RangeError('Amount must be a bigint IRR value');
  }
  assertPositiveStep(stepIrr);

  const remainder = amount % stepIrr;
  if (remainder === 0n) {
    return amount;
  }

  const floored = remainder > 0n ? amount - remainder : amount - remainder - stepIrr;

  switch (mode) {
    case 'UP':
      return floored + stepIrr;
    case 'DOWN':
      return floored;
    case 'HALF_UP': {
      const distanceFromFloor = amount - floored;
      return distanceFromFloor * 2n >= stepIrr ? floored + stepIrr : floored;
    }
    default:
      throw new RangeError(`Unsupported rounding mode: ${String(mode)}`);
  }
}

/* ============================================================================
 * Foreign currency -> IRR
 * ==========================================================================*/

/**
 * Multiply a foreign-currency `Decimal` by an IRR-per-unit `Decimal` rate and
 * return an exact integer IRR amount, FLOORED.
 *
 * Flooring (not rounding) is deliberate and is the only safe direction for a
 * COST: it can never overstate what we owe the supplier, so a downstream
 * comparison against the real supplier invoice can only ever find us short by
 * fractions of a rial, never over-collecting on a phantom cost.
 *
 * Both operands are re-parsed into the private 100-digit context first, so a
 * `Decimal` built by another module with a lower global precision cannot leak
 * its rounding into a price.
 */
export function decimalToIrr(amount: Decimal, rate: Decimal): Irr {
  if (!amount.isFinite() || !rate.isFinite()) {
    throw new RangeError('Foreign amount and FX rate must be finite Decimal values');
  }
  if (amount.lessThan(0)) {
    throw new RangeError('Foreign amount may not be negative');
  }
  /*
   * `rate.isPositive()` would NOT do: decimal.js gives zero a positive sign, so
   * `new Decimal(0).isPositive()` is `true` and a zero rate would sail past the
   * guard and make every product free.
   */
  if (rate.lessThanOrEqualTo(0)) {
    throw new RangeError('FX rate must be greater than zero');
  }

  const product = new FinancialDecimal(amount.toString()).mul(new FinancialDecimal(rate.toString()));
  return BigInt(product.toDecimalPlaces(0, FinancialDecimal.ROUND_FLOOR).toFixed(0));
}

/**
 * Apply bps to a `Decimal` rate without ever converting it to a JS number.
 * Returns the ADJUSTMENT, not the adjusted rate.
 */
export function applyBpsToDecimal(value: Decimal, bps: Bps): Decimal {
  assertIntegerBps(bps);
  if (!value.isFinite()) {
    throw new RangeError('Decimal value must be finite');
  }

  const result = new FinancialDecimal(value.toString())
    .mul(bps.toString())
    .div(BPS_DENOMINATOR.toString());
  return new Decimal(result.toString());
}

/**
 * Clamp a `Decimal` to the scale of the database's `Decimal(18, 6)` columns.
 *
 * Applying bps to a rate that already carries 6 decimals produces up to 10, and
 * a rate we cannot persist or transport verbatim is a rate we cannot audit. The
 * engine quantises FIRST and then prices with the quantised value, so the
 * `effectiveFxRate` recorded on a quote is byte-for-byte the rate that produced
 * its amount.
 */
export function quantizeToScale(value: Decimal, scale: number = DECIMAL_SCALE): Decimal {
  if (!Number.isSafeInteger(scale) || scale < 0) {
    throw new RangeError('Decimal scale must be a non-negative safe integer');
  }
  if (!value.isFinite()) {
    throw new RangeError('Decimal value must be finite');
  }

  const quantized = new FinancialDecimal(value.toString()).toDecimalPlaces(
    scale,
    FinancialDecimal.ROUND_HALF_UP,
  );
  return new Decimal(quantized.toString());
}

/**
 * Render a `Decimal` as a plain fixed-point string with no exponent.
 *
 * `toString()` would emit `1.92e+6` for large rates, which every schema in
 * `@barat/contracts` rejects — on purpose, because an exponent in a stored
 * price is a parsing accident waiting to happen.
 */
export function decimalToPlainString(value: Decimal): string {
  if (!value.isFinite()) {
    throw new RangeError('Decimal value must be finite');
  }

  return value.toFixed(Math.max(value.decimalPlaces(), 0));
}

/* ============================================================================
 * Aggregation
 * ==========================================================================*/

/** Sum IRR amounts with no intermediate precision loss. */
export function sumIrr(amounts: readonly Irr[]): Irr {
  let total = 0n;
  for (const amount of amounts) {
    if (typeof amount !== 'bigint') {
      throw new RangeError('Every amount in the sum must be a bigint IRR value');
    }
    total += amount;
  }
  return total;
}
