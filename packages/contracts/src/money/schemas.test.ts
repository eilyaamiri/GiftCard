import { describe, expect, it } from 'vitest';

import {
  bpsSchema,
  decimalStringSchema,
  fxRateStringSchema,
  irrStringSchema,
  positiveIrrStringSchema,
  signedBpsSchema,
} from './schemas';

describe('IRR wire values', () => {
  it.each(['0', '1', '19200000', '-250'])('accepts an integer digit string: %s', (value) => {
    expect(irrStringSchema.safeParse(value).success).toBe(true);
  });

  it.each(['', '1.0', '1e6', '+1', '--1', '-0', ' 10 ', 10])(
    'rejects a non-canonical IRR value: %s',
    (value) => {
      expect(irrStringSchema.safeParse(value).success).toBe(false);
    },
  );

  it('allows zero but rejects negative customer-facing amounts', () => {
    expect(positiveIrrStringSchema.safeParse('0').success).toBe(true);
    expect(positiveIrrStringSchema.safeParse('-1').success).toBe(false);
  });
});

describe('Decimal(18,6) wire values', () => {
  it.each([
    '0',
    '0.000001',
    '12.500000',
    '999999999999',
    '999999999999.999999',
    '-999999999999.999999',
  ])('accepts a value that fits precision 18, scale 6: %s', (value) => {
    expect(decimalStringSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    '1000000000000', // 13 integer digits
    '9999999999999.0', // 13 integer digits even with a short fraction
    '1.0000000', // scale 7
    '1e6',
    '.5',
    '1.',
    '+1',
  ])('rejects a value outside Decimal(18,6): %s', (value) => {
    expect(decimalStringSchema.safeParse(value).success).toBe(false);
  });

  it('requires a strictly positive FX rate without converting through Number', () => {
    expect(fxRateStringSchema.safeParse('0').success).toBe(false);
    expect(fxRateStringSchema.safeParse('0.000000').success).toBe(false);
    expect(fxRateStringSchema.safeParse('0.000001').success).toBe(true);
    expect(fxRateStringSchema.safeParse('1920000.000000').success).toBe(true);
  });
});

describe('basis points', () => {
  it.each([0, 100, 10_000, 1_000_000])('accepts a non-negative integer bps: %s', (value) => {
    expect(bpsSchema.safeParse(value).success).toBe(true);
  });

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 1_000_001])(
    'rejects an invalid bps value: %s',
    (value) => {
      expect(bpsSchema.safeParse(value).success).toBe(false);
    },
  );

  it('allows signed bps only for variance measurements', () => {
    expect(signedBpsSchema.safeParse(-250).success).toBe(true);
    expect(bpsSchema.safeParse(-250).success).toBe(false);
  });
});
