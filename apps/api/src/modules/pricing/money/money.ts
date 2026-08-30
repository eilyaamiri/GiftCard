import Decimal from 'decimal.js';

import type { Bps, Irr, RoundingMode, Toman } from '@barat/contracts';
import { BPS_DENOMINATOR, IRR_PER_TOMAN } from '@barat/contracts';

/**
 * A private high-precision Decimal constructor for financial calculations.
 * Keeping this clone local avoids changing Decimal.js' process-wide defaults.
 */
const FinancialDecimal = Decimal.clone({
  precision: 100,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

function assertIntegerBps(bps: Bps): void {
  if (!Number.isSafeInteger(bps)) {
    throw new RangeError('Basis points must be a safe integer');
  }
}

function assertPositiveStep(stepIrr: Irr): void {
  if (stepIrr <= 0n) {
    throw new RangeError('Rounding step must be greater than zero IRR');
  }
}

/** Convert an exact IRR amount to Toman without silently discarding a rial. */
export function irrToToman(amountIrr: Irr): Toman {
  if (amountIrr % IRR_PER_TOMAN !== 0n) {
    throw new RangeError('IRR amount is not exactly divisible by 10');
  }

  return (amountIrr / IRR_PER_TOMAN) as Toman;
}

/** Convert an integer Toman amount to IRR. This multiplication is always exact. */
export function tomanToIrr(amountToman: Toman | bigint): Irr {
  return amountToman * IRR_PER_TOMAN;
}

/**
 * Apply integer basis points using integer arithmetic only.
 * HALF_UP is the pricing default and rounds ties away from zero.
 */
export function applyBps(
  amount: Irr,
  bps: Bps,
  mode: RoundingMode = 'HALF_UP',
): Irr {
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

/** Round toward positive infinity to the nearest positive IRR step. */
export function roundUpToStep(amount: Irr, stepIrr: Irr): Irr {
  assertPositiveStep(stepIrr);

  const remainder = amount % stepIrr;
  if (remainder === 0n) {
    return amount;
  }

  return remainder > 0n ? amount + stepIrr - remainder : amount - remainder;
}

/**
 * Multiply a Decimal foreign amount by a Decimal IRR rate and floor the result.
 * Decimal values are copied into the private 100-digit context before arithmetic.
 */
export function decimalToIrr(amount: Decimal, rate: Decimal): Irr {
  if (!amount.isFinite() || !rate.isFinite()) {
    throw new RangeError('Foreign amount and FX rate must be finite Decimal values');
  }
  if (amount.isNegative()) {
    throw new RangeError('Foreign amount may not be negative');
  }
  if (!rate.isPositive()) {
    throw new RangeError('FX rate must be greater than zero');
  }

  const product = new FinancialDecimal(amount.toString()).mul(
    new FinancialDecimal(rate.toString()),
  );
  return BigInt(product.toDecimalPlaces(0, FinancialDecimal.ROUND_FLOOR).toFixed(0));
}

/** Apply bps to a Decimal rate without converting the rate to a JS number. */
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

/** Exact integer ratio, rounded HALF_UP, used for derived auditable bps fields. */
export function ratioToBps(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n) {
    throw new RangeError('Ratio denominator must be greater than zero');
  }

  const scaled = numerator * BigInt(BPS_DENOMINATOR);
  const quotient = scaled / denominator;
  const remainder = scaled % denominator;
  const direction = scaled < 0n ? -1n : 1n;
  const rounded =
    absBigInt(remainder) * 2n >= denominator ? quotient + direction : quotient;

  if (rounded > BigInt(Number.MAX_SAFE_INTEGER) || rounded < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Derived basis-point value exceeds the safe integer range');
  }

  return Number(rounded);
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}
