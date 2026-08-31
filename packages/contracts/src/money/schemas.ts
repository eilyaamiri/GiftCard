import { z } from 'zod';

import { BPS_DENOMINATOR, type Bps, type DecimalString, type IrrString } from './types';

/**
 * Wire representation of an IRR amount.
 *
 * JSON has no bigint, so every API surface carries rial as a digit string. The
 * regex forbids a decimal point on purpose: a fractional rial is a bug.
 */
export const irrStringSchema = z
  .string()
  .regex(/^-?\d{1,25}$/u, 'IRR must be an integer digit string with no decimal point')
  .refine((value) => value !== '-0', 'IRR must not be negative zero')
  .transform((value) => value as IrrString);

/** Non-negative IRR wire value — prices, fees, totals. */
export const positiveIrrStringSchema = irrStringSchema.refine(
  (value) => !value.startsWith('-'),
  'This amount may not be negative',
);

/** Server-internal IRR value once parsed. */
export const irrSchema = z.bigint();

/** Server-internal non-negative IRR value. */
export const nonNegativeIrrSchema = z.bigint().nonnegative();

/**
 * Integer basis points. Upper bound is 1_000_000 bps (10_000%) — high enough for
 * a hyper-inflationary spread, low enough to catch a misplaced decimal.
 */
export const bpsSchema = z
  .number()
  .int('Basis points must be an integer — 100 bps = 1%')
  .min(0)
  .max(1_000_000)
  .transform((value) => value as Bps);

/** Signed basis points, for variance and drift measurements. */
export const signedBpsSchema = z
  .number()
  .int('Basis points must be an integer — 100 bps = 1%')
  .min(-1_000_000)
  .max(1_000_000)
  .transform((value) => value as Bps);

/**
 * Fixed-point decimal string matching Prisma `Decimal(18, 6)`.
 * Up to 18 significant digits, up to 6 fractional digits.
 */
export const decimalStringSchema = z
  .string()
  .regex(
    /^-?\d{1,12}(\.\d{1,6})?$/u,
    'Must fit Decimal(18,6): at most 12 integer digits and 6 fractional digits',
  )
  .transform((value) => value as DecimalString);

/** Non-negative decimal string. */
export const positiveDecimalStringSchema = decimalStringSchema.refine(
  (value) => !value.startsWith('-'),
  'This amount may not be negative',
);

/** An FX rate must be strictly greater than zero — a zero rate would make everything free. */
export const fxRateStringSchema = positiveDecimalStringSchema.refine(
  (value) => /[1-9]/u.test(value),
  'FX rate must be greater than zero',
);

/** ISO-4217 code. */
export const currencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/u, 'Currency must be a 3-letter uppercase ISO-4217 code');

/** Runtime constant re-export so consumers never hardcode 10_000. */
export const BPS_DENOMINATOR_VALUE = BPS_DENOMINATOR;
