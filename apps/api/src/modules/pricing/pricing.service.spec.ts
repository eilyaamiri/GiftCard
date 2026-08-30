import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';

import type { DecimalString, FxRateSnapshot } from '@barat/contracts';

import {
  applyBps,
  applyBpsToDecimal,
  decimalToIrr,
  decimalToPlainString,
  irrToToman,
  quantizeToScale,
  ratioToBps,
  roundToStep,
  roundUpToStep,
  sumIrr,
  tomanToIrr,
} from './money';
import { computeQuote, PricingService } from './pricing.service';
import type { PricingInput, PricingRule } from './pricing.types';
import { SimulatorService } from './simulator.service';

/* ============================================================================
 * Fixtures
 *
 * Every expected number in this file was derived independently (exact rational
 * arithmetic, outside this codebase) and then asserted here. They are NOT
 * snapshots of whatever the implementation happened to print — a golden test
 * that records the current behaviour cannot detect a regression in it.
 * ==========================================================================*/

const BASE_RULE: PricingRule = Object.freeze({
  id: 'rule_base',
  name: 'POC global',
  version: 1,
  fxSpreadBps: 150, // 1.5%
  fxRiskBufferBps: 100, // 1.0%
  serviceFeeBps: 200, // 2.0%
  serviceFeeFixedIrr: 20_000n,
  operationalFeeIrr: 50_000n,
  targetMarginBps: 400, // 4.0%
  minimumMarginIrr: 200_000n,
  paymentFeeBps: 150, // 1.5%
  paymentFeeFixedIrr: 5_000n,
  quoteTtlSeconds: 600,
  roundingStepIrr: 10_000n,
  maxSupplierCostToleranceBps: 500,
});

function rule(overrides: Partial<PricingRule> = {}): PricingRule {
  return Object.freeze({ ...BASE_RULE, ...overrides });
}

function fxAt(midRate: string, overrides: Partial<FxRateSnapshot> = {}): FxRateSnapshot {
  const at = '2026-08-30T12:00:00.000Z';
  return Object.freeze({
    id: 'fx_1',
    pair: 'USD_IRR',
    buyRate: midRate as DecimalString,
    sellRate: midRate as DecimalString,
    midRate: midRate as DecimalString,
    provider: 'primary-nav',
    source: 'API',
    receivedAt: at,
    effectiveAt: at,
    expiresAt: null,
    isManualOverride: false,
    overrideReason: null,
    ageSeconds: 5,
    isStale: false,
    ...overrides,
  }) as FxRateSnapshot;
}

function input(overrides: Partial<PricingInput> = {}): PricingInput {
  return { supplierCostUsd: new Decimal('10'), quantity: 1, ...overrides };
}

/* ============================================================================
 * Money primitives
 * ==========================================================================*/

describe('money / irrToToman + tomanToIrr', () => {
  it('converts an exactly divisible amount', () => {
    expect(irrToToman(20_424_000_0n)).toBe(20_424_000n);
    expect(irrToToman(0n)).toBe(0n);
  });

  it('THROWS rather than truncating a non-divisible amount', () => {
    // Truncating 1 rial per order is a real, unreconcilable money loss.
    for (const amount of [1n, 9n, 11n, 199_999n, -3n]) {
      expect(() => irrToToman(amount)).toThrow(/not exactly divisible by 10/u);
    }
  });

  it('round-trips exactly in both directions', () => {
    for (const toman of [0n, 1n, 192_000n, 10n ** 25n]) {
      expect(irrToToman(tomanToIrr(toman))).toBe(toman);
    }
    expect(tomanToIrr(192_000n)).toBe(1_920_000n);
  });

  it('rejects a non-bigint, which is how a float would arrive', () => {
    expect(() => irrToToman(100 as unknown as bigint)).toThrow(/must be a bigint/u);
    expect(() => tomanToIrr(1.5 as unknown as bigint)).toThrow(/must be a bigint/u);
  });
});

describe('money / applyBps', () => {
  it('applies whole percentages exactly', () => {
    expect(applyBps(1_000_000n, 250)).toBe(25_000n); // 2.5%
    expect(applyBps(1_000_000n, 10_000)).toBe(1_000_000n); // 100%
    expect(applyBps(1_000_000n, 0)).toBe(0n);
    expect(applyBps(0n, 9_999)).toBe(0n);
  });

  it('keeps sub-rial precision that a float multiply would lose', () => {
    // 12_345 * 1bps = 1.2345 -> 1 ; the naive float path gives 1.2345000000000002
    expect(applyBps(12_345n, 1)).toBe(1n);
    expect(applyBps(9_999n, 1)).toBe(1n); // 0.9999 -> HALF_UP -> 1
    expect(applyBps(10_001n, 1)).toBe(1n); // 1.0001 -> 1
    expect(applyBps(50_000n, 1)).toBe(5n); // exact
    expect(applyBps(1n, 10_000)).toBe(1n);
  });

  it('rounds a tie away from zero under HALF_UP', () => {
    expect(applyBps(5n, 5_000)).toBe(3n); // 2.5 -> 3
    expect(applyBps(-5n, 5_000)).toBe(-3n); // -2.5 -> -3, symmetric
    expect(applyBps(15n, 5_000)).toBe(8n); // 7.5 -> 8
  });

  it('honours DOWN and UP explicitly', () => {
    expect(applyBps(5n, 5_000, 'DOWN')).toBe(2n);
    expect(applyBps(5n, 5_000, 'UP')).toBe(3n);
    expect(applyBps(10_001n, 1, 'DOWN')).toBe(1n);
    expect(applyBps(10_001n, 1, 'UP')).toBe(2n);
    expect(applyBps(-5n, 5_000, 'DOWN')).toBe(-2n);
    expect(applyBps(-5n, 5_000, 'UP')).toBe(-3n);
    // No remainder: every mode agrees.
    expect(applyBps(20_000n, 5_000, 'UP')).toBe(10_000n);
    expect(applyBps(20_000n, 5_000, 'DOWN')).toBe(10_000n);
  });

  it('loses nothing on an amount far beyond Number.MAX_SAFE_INTEGER', () => {
    const huge = 987_654_321_987_654_321_987n; // ~1e21
    expect(applyBps(huge, 137)).toBe(13_530_864_211_230_864_211n);
    // Same value through a float would be wrong by thousands of rial.
    expect(Number.isSafeInteger(Number(huge))).toBe(false);
  });

  it('rejects a fractional bps — 13 bps is legal, 12.5 bps is a bug', () => {
    expect(() => applyBps(100n, 12.5)).toThrow(/safe integer/u);
    expect(() => applyBps(100n, Number.NaN)).toThrow(/safe integer/u);
    expect(() => applyBps(100n, 2 ** 60)).toThrow(/safe integer/u);
  });

  it('rejects an unknown rounding mode instead of silently truncating', () => {
    expect(() => applyBps(5n, 5_000, 'BANKERS' as never)).toThrow(/Unsupported rounding mode/u);
  });
});

describe('money / roundUpToStep + roundToStep', () => {
  it('leaves an exact multiple untouched — the boundary case', () => {
    expect(roundUpToStep(0n, 10_000n)).toBe(0n);
    expect(roundUpToStep(10_000n, 10_000n)).toBe(10_000n);
    expect(roundUpToStep(204_240_000n, 10_000n)).toBe(204_240_000n);
  });

  it('rounds up from one rial over and one rial under the boundary', () => {
    expect(roundUpToStep(10_001n, 10_000n)).toBe(20_000n);
    expect(roundUpToStep(19_999n, 10_000n)).toBe(20_000n);
    expect(roundUpToStep(1n, 10_000n)).toBe(10_000n);
  });

  it('rounds toward positive infinity for negatives, never away from zero', () => {
    // -10_001 -> -10_000, i.e. we do not hand back an extra step.
    expect(roundUpToStep(-10_001n, 10_000n)).toBe(-10_000n);
    expect(roundUpToStep(-9_999n, 10_000n)).toBe(0n);
    expect(roundUpToStep(-10_000n, 10_000n)).toBe(-10_000n);
  });

  it('supports a step of 1 (no rounding) and a very large step', () => {
    expect(roundUpToStep(123_457n, 1n)).toBe(123_457n);
    expect(roundUpToStep(1n, 1_000_000_000n)).toBe(1_000_000_000n);
  });

  it('rejects a zero or negative step, which would divide by zero or invert', () => {
    expect(() => roundUpToStep(100n, 0n)).toThrow(/greater than zero/u);
    expect(() => roundUpToStep(100n, -10n)).toThrow(/greater than zero/u);
  });

  it('roundToStep applies an explicit mode around the midpoint', () => {
    expect(roundToStep(15_000n, 10_000n, 'HALF_UP')).toBe(20_000n); // exact tie
    expect(roundToStep(14_999n, 10_000n, 'HALF_UP')).toBe(10_000n);
    expect(roundToStep(15_001n, 10_000n, 'HALF_UP')).toBe(20_000n);
    expect(roundToStep(19_999n, 10_000n, 'DOWN')).toBe(10_000n);
    expect(roundToStep(10_001n, 10_000n, 'UP')).toBe(20_000n);
    expect(roundToStep(-15_000n, 10_000n, 'HALF_UP')).toBe(-10_000n);
    expect(roundToStep(-15_001n, 10_000n, 'DOWN')).toBe(-20_000n);
    // Already on a boundary: returned untouched under every mode.
    expect(roundToStep(20_000n, 10_000n, 'UP')).toBe(20_000n);
    expect(roundToStep(0n, 10_000n, 'DOWN')).toBe(0n);
    expect(() => roundToStep(1n, 10n, 'NEAREST' as never)).toThrow(/Unsupported rounding mode/u);
  });
});

describe('money / decimalToIrr', () => {
  it('floors the product so a cost is never overstated', () => {
    expect(decimalToIrr(new Decimal('96.5'), new Decimal('1920000'))).toBe(185_280_000n);
    expect(decimalToIrr(new Decimal('0.0000001'), new Decimal('1'))).toBe(0n);
    expect(decimalToIrr(new Decimal('1.9999999'), new Decimal('1'))).toBe(1n);
  });

  it('is exact at 18 digits, where float64 has already failed', () => {
    const amount = new Decimal('99999999999.999999');
    const rate = new Decimal('1920000.123456');

    expect(decimalToIrr(amount, rate)).toBe(192_000_012_345_599_998n);

    /*
     * The same two wire values parsed into float64 instead. `Number(...)` rather
     * than a numeric literal because the literal itself cannot round-trip — which
     * is the whole point, and which `no-loss-of-precision` correctly refuses to
     * let us write down. The answer is 2 rial high here and the error grows
     * without bound as amounts do.
     */
    const floatAmount = Number('99999999999.999999');
    const floatRate = Number('1920000.123456');
    expect(BigInt(Math.floor(floatAmount * floatRate))).toBe(192_000_012_345_600_000n);
  });

  it('accepts a zero amount but rejects a zero or negative rate', () => {
    expect(decimalToIrr(new Decimal('0'), new Decimal('1920000'))).toBe(0n);
    expect(() => decimalToIrr(new Decimal('1'), new Decimal('0'))).toThrow(/greater than zero/u);
    expect(() => decimalToIrr(new Decimal('1'), new Decimal('-1'))).toThrow(/greater than zero/u);
  });

  it('rejects a negative amount and non-finite operands', () => {
    expect(() => decimalToIrr(new Decimal('-1'), new Decimal('1'))).toThrow(/may not be negative/u);
    expect(() => decimalToIrr(new Decimal(Infinity), new Decimal('1'))).toThrow(/finite/u);
    expect(() => decimalToIrr(new Decimal(NaN), new Decimal('1'))).toThrow(/finite/u);
  });
});

describe('money / quantizeToScale, ratioToBps, sumIrr', () => {
  it('quantises to the Decimal(18,6) database scale, HALF_UP', () => {
    expect(quantizeToScale(new Decimal('1.23456749')).toString()).toBe('1.234567');
    expect(quantizeToScale(new Decimal('1.2345675')).toString()).toBe('1.234568');
    expect(quantizeToScale(new Decimal('1920000')).toString()).toBe('1920000');
  });

  it('derives basis points exactly and refuses a zero denominator', () => {
    expect(ratioToBps(25_000n, 1_000_000n)).toBe(250);
    expect(ratioToBps(1n, 3n)).toBe(3_333);
    expect(ratioToBps(-25_000n, 1_000_000n)).toBe(-250);
    expect(() => ratioToBps(1n, 0n)).toThrow(/greater than zero/u);
  });

  it('sums without intermediate loss and rejects a non-bigint member', () => {
    expect(sumIrr([1n, 2n, 3n])).toBe(6n);
    expect(sumIrr([])).toBe(0n);
    expect(sumIrr([10n ** 30n, 1n])).toBe(10n ** 30n + 1n);
    expect(() => sumIrr([1n, 2 as unknown as bigint])).toThrow(/bigint/u);
  });
});

describe('money / remaining guard branches', () => {
  it('applyBps and rounding reject a non-bigint amount', () => {
    expect(() => applyBps(100 as unknown as bigint, 150)).toThrow(/bigint IRR value/u);
    expect(() => roundUpToStep(100 as unknown as bigint, 10n)).toThrow(/bigint IRR value/u);
    expect(() => roundToStep(100 as unknown as bigint, 10n, 'UP')).toThrow(/bigint IRR value/u);
  });

  it('rounding rejects a non-bigint step', () => {
    expect(() => roundUpToStep(100n, 10 as unknown as bigint)).toThrow(/must be a bigint/u);
    expect(() => roundToStep(100n, 10 as unknown as bigint, 'UP')).toThrow(/must be a bigint/u);
  });

  it('ratioToBps rejects non-bigint operands and an unsafe result', () => {
    expect(() => ratioToBps(1 as unknown as bigint, 2n)).toThrow(/bigint values/u);
    expect(() => ratioToBps(1n, 2 as unknown as bigint)).toThrow(/bigint values/u);
    // 1e30 / 1 in bps overflows the safe integer range rather than losing digits.
    expect(() => ratioToBps(10n ** 30n, 1n)).toThrow(/exceeds the safe integer range/u);
  });

  it('quantizeToScale rejects a bad scale or a non-finite value', () => {
    expect(() => quantizeToScale(new Decimal('1'), -1)).toThrow(/non-negative safe integer/u);
    expect(() => quantizeToScale(new Decimal('1'), 1.5)).toThrow(/non-negative safe integer/u);
    expect(() => quantizeToScale(new Decimal(Infinity))).toThrow(/finite/u);
    expect(quantizeToScale(new Decimal('1.25'), 1).toString()).toBe('1.3');
  });

  it('applyBpsToDecimal rejects a fractional bps and a non-finite value', () => {
    expect(() => applyBpsToDecimal(new Decimal('100'), 1.5)).toThrow(/safe integer/u);
    expect(() => applyBpsToDecimal(new Decimal(NaN), 150)).toThrow(/finite/u);
    expect(applyBpsToDecimal(new Decimal('1920000'), 150).toString()).toBe('28800');
  });

  it('decimalToPlainString never emits scientific notation', () => {
    expect(decimalToPlainString(new Decimal('1.92e6'))).toBe('1920000');
    expect(decimalToPlainString(new Decimal('0.000001'))).toBe('0.000001');
    expect(decimalToPlainString(new Decimal('1e21'))).toBe('1000000000000000000000');
    expect(() => decimalToPlainString(new Decimal(Infinity))).toThrow(/finite/u);
  });
});

/* ============================================================================
 * computeQuote — the formula
 * ==========================================================================*/

describe('computeQuote / golden value with realistic POC numbers', () => {
  /*
   * $96.50 at a market rate of 1,920,000 IRR/USD with the POC rule.
   *
   *   effectiveFxRate = 1,920,000 + 1.5% + 1.0%   = 1,968,000
   *   supplierCostIrr = 96.50 x 1,968,000         = 189,912,000
   *   paymentFee      = 1.5% + 5,000              =   2,853,680
   *   serviceFee      = 2.0% + 20,000             =   3,818,240
   *   operationalFee  =                              50,000
   *   margin          = 4.0% (7,596,480) > floor  =   7,596,480
   *   subtotal                                    = 204,230,400
   *   finalAmountIrr  = roundUp to 10,000         = 204,240,000
   */
  const result = computeQuote(
    input({ supplierCostUsd: new Decimal('96.50') }),
    rule(),
    fxAt('1920000'),
  );

  it('produces the exact effective FX rate', () => {
    expect(result.marketFxRate).toBe('1920000');
    expect(result.effectiveFxRate).toBe('1968000');
  });

  it('produces the exact supplier cost in IRR', () => {
    expect(result.marketSupplierCostIrr).toBe(185_280_000n);
    expect(result.supplierCostIrr).toBe(189_912_000n);
  });

  it('produces the exact fees and margin', () => {
    expect(result.paymentFee).toBe(2_853_680n);
    expect(result.serviceFee).toBe(3_818_240n);
    expect(result.operationalFee).toBe(50_000n);
    expect(result.marginAmount).toBe(7_596_480n);
    expect(result.marginFloorApplied).toBe(false);
    expect(result.discountAmount).toBe(0n);
  });

  it('produces the exact totals', () => {
    expect(result.subtotal).toBe(204_230_400n);
    expect(result.roundingAdjustment).toBe(9_600n);
    expect(result.finalAmountIrr).toBe(204_240_000n);
    expect(result.displayAmountToman).toBe(20_424_000n);
  });

  it('produces the exact contribution and effective margin', () => {
    expect(result.contributionIrr).toBe(11_424_320n);
    expect(result.effectiveMarginBps).toBe(559);
  });

  it('splits the FX adjustment into auditable spread and buffer lines', () => {
    expect(result.fxSpreadAmount).toBe(2_779_200n);
    expect(result.fxRiskBufferAmount).toBe(1_852_800n);
    // The lines reconcile to the charged cost with no unexplained rial.
    expect(result.marketSupplierCostIrr + result.fxSpreadAmount + result.fxRiskBufferAmount).toBe(
      result.supplierCostIrr,
    );
  });
});

describe('computeQuote / auditability', () => {
  const result = computeQuote(input({ supplierCostUsd: new Decimal('96.50') }), rule(), fxAt('1920000'));

  it('sums its component lines back to exactly the amount charged', () => {
    const total = sumIrr(result.components.map((component) => component.amountIrr));
    expect(total).toBe(result.finalAmountIrr);
  });

  it('emits all nine component kinds in presentation order', () => {
    expect(result.components.map((component) => component.kind)).toEqual([
      'SUPPLIER_COST',
      'FX_SPREAD',
      'FX_RISK_BUFFER',
      'PAYMENT_FEE',
      'SERVICE_FEE',
      'OPERATIONAL_FEE',
      'MARGIN',
      'DISCOUNT',
      'ROUNDING',
    ]);
  });

  it('records the exact FX snapshot used, and the rule version', () => {
    expect(result.fxSnapshotUsed.provider).toBe('primary-nav');
    expect(result.fxSnapshotUsed.midRate).toBe('1920000');
    expect(result.fxSnapshotUsed.receivedAt).toBe('2026-08-30T12:00:00.000Z');
    expect(result.pricingVersion).toBe(1);
    expect(result.ruleId).toBe('rule_base');
  });

  it('reports an effective rate that actually reproduces the charged cost', () => {
    // Rule 4: the published rate must be the rate used, not a rounded display of it.
    expect(decimalToIrr(new Decimal('96.50'), new Decimal(result.effectiveFxRate))).toBe(
      result.supplierCostIrr,
    );
  });

  it('is pure — identical arguments give an identical result', () => {
    const again = computeQuote(
      input({ supplierCostUsd: new Decimal('96.50') }),
      rule(),
      fxAt('1920000'),
    );
    expect(again.finalAmountIrr).toBe(result.finalAmountIrr);
    expect(again.components).toEqual(result.components);
  });

  it('freezes the result so a caller cannot rewrite a price after the fact', () => {
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.components)).toBe(true);
    expect(Object.isFrozen(result.fxSnapshotUsed)).toBe(true);
  });

  it('does not alias the caller-supplied FX snapshot', () => {
    const snapshot = { ...fxAt('1920000') };
    const breakdown = computeQuote(input(), rule(), snapshot as FxRateSnapshot);
    expect(breakdown.fxSnapshotUsed).not.toBe(snapshot);
    expect(breakdown.fxSnapshotUsed.midRate).toBe('1920000');
  });
});

describe('computeQuote / zero supplier cost', () => {
  /*
   * A 100%-discounted or promotional SKU. Every bps component collapses to zero
   * and only the fixed fees plus the margin FLOOR remain:
   *   5,000 + 20,000 + 50,000 + 200,000 = 275,000 -> roundUp -> 280,000
   */
  const result = computeQuote(
    input({ supplierCostUsd: new Decimal('0') }),
    rule(),
    fxAt('1920000'),
  );

  it('charges only the fixed fees and the minimum margin', () => {
    expect(result.supplierCostIrr).toBe(0n);
    expect(result.marketSupplierCostIrr).toBe(0n);
    expect(result.fxSpreadAmount).toBe(0n);
    expect(result.fxRiskBufferAmount).toBe(0n);
    expect(result.paymentFee).toBe(5_000n);
    expect(result.serviceFee).toBe(20_000n);
    expect(result.operationalFee).toBe(50_000n);
    expect(result.marginAmount).toBe(200_000n);
    expect(result.marginFloorApplied).toBe(true);
    expect(result.subtotal).toBe(275_000n);
    expect(result.finalAmountIrr).toBe(280_000n);
    expect(result.contributionIrr).toBe(225_000n);
    expect(result.effectiveMarginBps).toBe(8_036);
  });

  it('does not divide by zero when everything nets to a free order', () => {
    const free = computeQuote(
      input({ supplierCostUsd: new Decimal('0') }),
      rule({
        serviceFeeFixedIrr: 0n,
        operationalFeeIrr: 0n,
        minimumMarginIrr: 0n,
        paymentFeeFixedIrr: 0n,
      }),
      fxAt('1920000'),
    );
    expect(free.finalAmountIrr).toBe(0n);
    expect(free.displayAmountToman).toBe(0n);
    expect(free.effectiveMarginBps).toBe(0);
    expect(free.contributionIrr).toBe(0n);
  });
});

describe('computeQuote / minimum margin flooring', () => {
  it('applies the floor when the bps margin falls below it', () => {
    // $1.00 -> cost 1,968,000 IRR; 4% = 78,720 < the 200,000 floor.
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('1') }),
      rule(),
      fxAt('1920000'),
    );
    expect(result.supplierCostIrr).toBe(1_968_000n);
    expect(result.marginFloorApplied).toBe(true);
    expect(result.marginAmount).toBe(200_000n);
    expect(result.subtotal).toBe(2_311_880n);
    expect(result.finalAmountIrr).toBe(2_320_000n);
  });

  it('prefers the bps margin as soon as it exceeds the floor', () => {
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('96.50') }),
      rule(),
      fxAt('1920000'),
    );
    expect(result.marginFloorApplied).toBe(false);
    expect(result.marginAmount).toBe(7_596_480n);
  });

  it('does not treat an exact tie as flooring — bps wins on equality', () => {
    // Choose a floor exactly equal to 4% of the cost.
    const cost = 1_968_000n;
    const exactFourPercent = applyBps(cost, 400);
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('1') }),
      rule({ minimumMarginIrr: exactFourPercent }),
      fxAt('1920000'),
    );
    expect(result.marginAmount).toBe(exactFourPercent);
    expect(result.marginFloorApplied).toBe(false);
  });

  it('honours a zero floor', () => {
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('1') }),
      rule({ minimumMarginIrr: 0n }),
      fxAt('1920000'),
    );
    expect(result.marginFloorApplied).toBe(false);
    expect(result.marginAmount).toBe(78_720n);
  });
});

describe('computeQuote / rounding step boundaries', () => {
  const stepRule = rule({
    fxSpreadBps: 0,
    fxRiskBufferBps: 0,
    serviceFeeBps: 0,
    serviceFeeFixedIrr: 0n,
    operationalFeeIrr: 0n,
    targetMarginBps: 0,
    minimumMarginIrr: 0n,
    paymentFeeBps: 0,
    paymentFeeFixedIrr: 0n,
  });

  /** Construct a quote whose subtotal is exactly `costIrr`. */
  function subtotalOf(costIrr: string, roundingStepIrr = 10_000n) {
    return computeQuote(
      input({ supplierCostUsd: new Decimal(costIrr) }),
      rule({ ...stepRule, roundingStepIrr }),
      fxAt('1'),
    );
  }

  it('does not move a subtotal already on the boundary', () => {
    const result = subtotalOf('200000');
    expect(result.subtotal).toBe(200_000n);
    expect(result.roundingAdjustment).toBe(0n);
    expect(result.finalAmountIrr).toBe(200_000n);
  });

  it('rounds up a subtotal one rial above the boundary by a full step less one', () => {
    const result = subtotalOf('200001');
    expect(result.subtotal).toBe(200_001n);
    expect(result.roundingAdjustment).toBe(9_999n);
    expect(result.finalAmountIrr).toBe(210_000n);
  });

  it('rounds up a subtotal one rial below the next boundary by exactly one rial', () => {
    const result = subtotalOf('209999');
    expect(result.roundingAdjustment).toBe(1n);
    expect(result.finalAmountIrr).toBe(210_000n);
  });

  it('never rounds down — the adjustment is always non-negative', () => {
    for (const cost of ['200001', '204999', '205000', '205001', '209999']) {
      const result = subtotalOf(cost);
      expect(result.roundingAdjustment >= 0n).toBe(true);
      expect(result.finalAmountIrr >= result.subtotal).toBe(true);
    }
  });

  it('supports a 10 IRR (1 Toman) step — the finest legal step', () => {
    const result = subtotalOf('200001', 10n);
    expect(result.finalAmountIrr).toBe(200_010n);
    expect(result.roundingAdjustment).toBe(9n);
  });

  it('supports a very coarse 1,000,000 IRR step', () => {
    const result = subtotalOf('200001', 1_000_000n);
    expect(result.finalAmountIrr).toBe(1_000_000n);
    expect(result.roundingAdjustment).toBe(799_999n);
  });

  it('always yields a whole-Toman displayable amount', () => {
    for (const cost of ['200001', '209999', '333333']) {
      const result = subtotalOf(cost);
      expect(result.finalAmountIrr % 10n).toBe(0n);
      expect(result.displayAmountToman).toBe(result.finalAmountIrr / 10n);
    }
  });

  it('rejects a rounding step that is not a whole Toman', () => {
    // A 3 IRR step would produce a final amount irrToToman must refuse.
    expect(() => subtotalOf('200001', 3n)).toThrow(/whole Toman/u);
  });

  it('rejects a zero or negative rounding step', () => {
    expect(() => subtotalOf('200001', 0n)).toThrow(/greater than zero/u);
    expect(() => subtotalOf('200001', -10n)).toThrow(/greater than zero/u);
  });
});

describe('computeQuote / bps precision', () => {
  it('applies spread and buffer additively, never compounded', () => {
    // 1,000,000 + 1.5% + 1.0% = 1,025,000, NOT 1,000,000 x 1.015 x 1.01 = 1,025,150.
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('1') }),
      rule({ fxSpreadBps: 150, fxRiskBufferBps: 100 }),
      fxAt('1000000'),
    );
    expect(result.effectiveFxRate).toBe('1025000');
    expect(result.supplierCostIrr).toBe(1_025_000n);
  });

  it('carries a single basis point through to the final amount', () => {
    const withoutBuffer = computeQuote(
      input({ supplierCostUsd: new Decimal('100') }),
      rule({ fxSpreadBps: 0, fxRiskBufferBps: 0 }),
      fxAt('1920000'),
    );
    const withOneBps = computeQuote(
      input({ supplierCostUsd: new Decimal('100') }),
      rule({ fxSpreadBps: 1, fxRiskBufferBps: 0 }),
      fxAt('1920000'),
    );
    // 1 bps of 1,920,000 = 192 IRR/USD; x100 USD = 19,200 IRR of extra cost.
    expect(withOneBps.supplierCostIrr - withoutBuffer.supplierCostIrr).toBe(19_200n);
    expect(withOneBps.finalAmountIrr).toBeGreaterThan(withoutBuffer.finalAmountIrr);
  });

  it('keeps a fractional-rial rate exact through Decimal(18,6)', () => {
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('1') }),
      rule({ fxSpreadBps: 1, fxRiskBufferBps: 0, targetMarginBps: 0, minimumMarginIrr: 0n }),
      fxAt('1920000.123456'),
    );
    // spread = 1920000.123456 * 0.0001 = 192.0000123456 -> 192.000012 at scale 6
    expect(result.effectiveFxRate).toBe('1920192.123468');
    expect(result.supplierCostIrr).toBe(1_920_192n); // floored
  });

  it('treats a 0 bps rule as an exact identity', () => {
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('96.50') }),
      rule({ fxSpreadBps: 0, fxRiskBufferBps: 0 }),
      fxAt('1920000'),
    );
    expect(result.effectiveFxRate).toBe('1920000');
    expect(result.supplierCostIrr).toBe(result.marketSupplierCostIrr);
    expect(result.fxSpreadAmount).toBe(0n);
    expect(result.fxRiskBufferAmount).toBe(0n);
  });

  it('handles a 100% (10,000 bps) margin without overflow or drift', () => {
    const result = computeQuote(
      input({ supplierCostUsd: new Decimal('10') }),
      rule({
        fxSpreadBps: 0,
        fxRiskBufferBps: 0,
        targetMarginBps: 10_000,
        paymentFeeBps: 0,
        serviceFeeBps: 0,
        paymentFeeFixedIrr: 0n,
        serviceFeeFixedIrr: 0n,
        operationalFeeIrr: 0n,
        minimumMarginIrr: 0n,
      }),
      fxAt('1920000'),
    );
    expect(result.supplierCostIrr).toBe(19_200_000n);
    expect(result.marginAmount).toBe(19_200_000n);
    expect(result.finalAmountIrr).toBe(38_400_000n);
  });
});

describe('computeQuote / very large amounts', () => {
  /*
   * ~$100bn at a 6-decimal rate. The exact product is an 18-digit integer, well
   * past float64's 2^53 exact-integer ceiling — the classic place a naive
   * implementation silently loses hundreds of rial.
   */
  const result = computeQuote(
    input({ supplierCostUsd: new Decimal('999999999.999999'), quantity: 100 }),
    rule(),
    fxAt('1920000.123456'),
  );

  it('computes an 18-digit supplier cost exactly', () => {
    expect(result.effectiveFxRate).toBe('1968000.126542');
    expect(result.supplierCostIrr).toBe(196_800_012_654_199_803n);
    expect(Number.isSafeInteger(Number(result.supplierCostIrr))).toBe(false);
  });

  it('differs from the float64 answer, proving no float ever touched it', () => {
    const floatAnswer = BigInt(
      Math.floor(999_999_999.999999 * 100 * 1_968_000.126542),
    );
    // Tens of rial of pure float rounding noise, and the exact size of the
    // error depends on operation order — which is the point.
    expect(floatAnswer).not.toBe(result.supplierCostIrr);
    const drift = floatAnswer - result.supplierCostIrr;
    expect(drift > 0n ? drift : -drift).toBeGreaterThan(0n);
  });

  it('keeps fees, margin and totals exact at that magnitude', () => {
    expect(result.paymentFee).toBe(2_952_000_189_817_997n);
    expect(result.serviceFee).toBe(3_936_000_253_103_996n);
    expect(result.marginAmount).toBe(7_872_000_506_167_992n);
    expect(result.subtotal).toBe(211_560_013_603_339_788n);
    expect(result.finalAmountIrr).toBe(211_560_013_603_340_000n);
    expect(result.displayAmountToman).toBe(21_156_001_360_334_000n);
  });

  it('still reconciles its component lines to the exact total', () => {
    expect(sumIrr(result.components.map((component) => component.amountIrr))).toBe(
      result.finalAmountIrr,
    );
    expect(result.fxSpreadAmount).toBe(2_880_000_185_199_998n);
    expect(result.fxRiskBufferAmount).toBe(1_920_000_123_399_998n);
  });

  it('reports contribution and effective margin without precision loss', () => {
    expect(result.contributionIrr).toBe(11_808_000_759_272_200n);
    expect(result.effectiveMarginBps).toBe(558);
  });
});

describe('computeQuote / quantity', () => {
  it('multiplies the supplier cost, not the fixed fees', () => {
    const one = computeQuote(input({ supplierCostUsd: new Decimal('10'), quantity: 1 }), rule(), fxAt('1920000'));
    const ten = computeQuote(input({ supplierCostUsd: new Decimal('10'), quantity: 10 }), rule(), fxAt('1920000'));

    expect(ten.supplierCostIrr).toBe(one.supplierCostIrr * 10n);
    expect(ten.operationalFee).toBe(one.operationalFee); // fixed, charged once
    expect(ten.paymentFee - 5_000n).toBe((one.paymentFee - 5_000n) * 10n); // bps part scales
    expect(ten.quantity).toBe(10);
    expect(ten.supplierCostUsd).toBe('10'); // unit price preserved
    expect(ten.totalSupplierCostUsd).toBe('100');
  });

  it('rejects a zero, negative or fractional quantity', () => {
    for (const quantity of [0, -1, 1.5, Number.NaN]) {
      expect(() => computeQuote(input({ quantity }), rule(), fxAt('1920000'))).toThrow(
        /Quantity must be a positive safe integer/u,
      );
    }
  });
});

describe('computeQuote / discount', () => {
  it('subtracts the discount before rounding', () => {
    const base = computeQuote(input({ supplierCostUsd: new Decimal('96.50') }), rule(), fxAt('1920000'));
    const discounted = computeQuote(
      input({ supplierCostUsd: new Decimal('96.50'), discountIrr: 4_230_400n }),
      rule(),
      fxAt('1920000'),
    );
    expect(discounted.discountAmount).toBe(4_230_400n);
    expect(discounted.subtotal).toBe(base.subtotal - 4_230_400n);
    expect(discounted.finalAmountIrr).toBe(200_000_000n);
    expect(discounted.roundingAdjustment).toBe(0n);
  });

  it('REJECTS a negative discount instead of silently inflating the price', () => {
    // A negative discount is a surcharge with no audit line. It must never price.
    expect(() =>
      computeQuote(input({ discountIrr: -1n }), rule(), fxAt('1920000')),
    ).toThrow(/Discount may not be negative/u);
    expect(() =>
      computeQuote(input({ discountIrr: -1_000_000n }), rule(), fxAt('1920000')),
    ).toThrow(/Discount may not be negative/u);
  });

  it('rejects a discount larger than the amount, which would owe the customer money', () => {
    expect(() =>
      computeQuote(input({ discountIrr: 10n ** 18n }), rule(), fxAt('1920000')),
    ).toThrow(/may not make the quote subtotal negative/u);
  });

  it('accepts a discount that lands exactly on zero', () => {
    const base = computeQuote(input(), rule(), fxAt('1920000'));
    const free = computeQuote(
      input({ discountIrr: base.subtotal }),
      rule(),
      fxAt('1920000'),
    );
    expect(free.subtotal).toBe(0n);
    expect(free.finalAmountIrr).toBe(0n);
    expect(free.effectiveMarginBps).toBe(0);
  });

  it('records the discount as a negative audit line', () => {
    const result = computeQuote(input({ discountIrr: 100_000n }), rule(), fxAt('1920000'));
    const line = result.components.find((component) => component.kind === 'DISCOUNT');
    expect(line?.amountIrr).toBe(-100_000n);
    expect(sumIrr(result.components.map((component) => component.amountIrr))).toBe(
      result.finalAmountIrr,
    );
  });
});

describe('computeQuote / rejected inputs', () => {
  it('refuses a stale FX snapshot — a stale rate never prices a quote', () => {
    expect(() =>
      computeQuote(input(), rule(), fxAt('1920000', { isStale: true, ageSeconds: 9_000 })),
    ).toThrow(/stale FX snapshot/u);
  });

  it('refuses a zero or negative FX midpoint, which would make everything free', () => {
    expect(() => computeQuote(input(), rule(), fxAt('0'))).toThrow(/finite positive/u);
    expect(() => computeQuote(input(), rule(), fxAt('-1920000'))).toThrow(/finite positive/u);
  });

  it('refuses a negative supplier cost', () => {
    expect(() =>
      computeQuote(input({ supplierCostUsd: new Decimal('-1') }), rule(), fxAt('1920000')),
    ).toThrow(/finite non-negative/u);
  });

  it('refuses a non-finite supplier cost', () => {
    expect(() =>
      computeQuote(input({ supplierCostUsd: new Decimal(Infinity) }), rule(), fxAt('1920000')),
    ).toThrow(/finite non-negative/u);
  });

  it('refuses a negative bps on any rule field', () => {
    for (const field of [
      'fxSpreadBps',
      'fxRiskBufferBps',
      'serviceFeeBps',
      'targetMarginBps',
      'paymentFeeBps',
      'maxSupplierCostToleranceBps',
    ] as const) {
      expect(() =>
        computeQuote(input(), rule({ [field]: -1 } as Partial<PricingRule>), fxAt('1920000')),
      ).toThrow(new RegExp(`${field} must be a non-negative safe integer`, 'u'));
    }
  });

  it('refuses a fractional bps on a rule field', () => {
    expect(() =>
      computeQuote(input(), rule({ serviceFeeBps: 12.5 }), fxAt('1920000')),
    ).toThrow(/serviceFeeBps must be a non-negative safe integer/u);
  });

  it('refuses a negative fixed IRR field', () => {
    for (const field of [
      'serviceFeeFixedIrr',
      'operationalFeeIrr',
      'minimumMarginIrr',
      'paymentFeeFixedIrr',
    ] as const) {
      expect(() =>
        computeQuote(input(), rule({ [field]: -1n } as Partial<PricingRule>), fxAt('1920000')),
      ).toThrow(new RegExp(`${field} must be a non-negative bigint`, 'u'));
    }
  });

  it('refuses a number where a bigint IRR field is required', () => {
    expect(() =>
      computeQuote(
        input(),
        rule({ operationalFeeIrr: 50_000 as unknown as bigint }),
        fxAt('1920000'),
      ),
    ).toThrow(/operationalFeeIrr must be a non-negative bigint/u);
  });

  it('refuses an invalid rule version', () => {
    expect(() => computeQuote(input(), rule({ version: 0 }), fxAt('1920000'))).toThrow(
      /version must be a positive safe integer/u,
    );
  });
});

/* ============================================================================
 * PricingService wire projection
 * ==========================================================================*/

describe('PricingService.toWirePricingBreakdown', () => {
  const service = new PricingService();
  const breakdown = service.computeQuote(
    input({ supplierCostUsd: new Decimal('96.50') }),
    rule(),
    fxAt('1920000'),
  );
  const wire = service.toWirePricingBreakdown(breakdown);

  it('emits every rial as a digit string, never a number', () => {
    expect(wire.finalAmountIrr).toBe('204240000');
    expect(wire.supplierCostIrr).toBe('189912000');
    expect(wire.displayAmountToman).toBe('20424000');
    expect(wire.discountAmount).toBe('0');
    for (const field of [
      wire.finalAmountIrr,
      wire.subtotal,
      wire.paymentFee,
      wire.serviceFee,
      wire.marginAmount,
      wire.contributionIrr,
    ]) {
      expect(typeof field).toBe('string');
      expect(field).toMatch(/^-?\d+$/u);
    }
  });

  it('survives JSON.stringify — a leaked bigint would throw here', () => {
    expect(() => JSON.stringify(wire)).not.toThrow();
    expect(() => JSON.stringify(breakdown)).toThrow(TypeError);
  });

  it('carries the FX provenance onto the wire', () => {
    expect(wire.fxProvider).toBe('primary-nav');
    expect(wire.fxRateTimestamp).toBe('2026-08-30T12:00:00.000Z');
    expect(wire.marketFxRate).toBe('1920000');
    expect(wire.effectiveFxRate).toBe('1968000');
  });

  it('labels every component in English and Persian with a stable sort order', () => {
    expect(wire.components).toHaveLength(9);
    wire.components.forEach((component, index) => {
      expect(component.sortOrder).toBe(index);
      expect(component.label.length).toBeGreaterThan(0);
      expect(component.labelFa.length).toBeGreaterThan(0);
    });
    expect(wire.components[0]?.labelFa).toBe('هزینه تأمین');
    expect(wire.components[0]?.currency).toBe('USD');
    expect(wire.components[0]?.amountForeign).toBe('96.5');
    expect(wire.components[3]?.currency).toBeNull();
    expect(wire.components[3]?.amountForeign).toBeNull();
  });

  it('keeps the negative discount line signed on the wire', () => {
    const discounted = service.toWirePricingBreakdown(
      service.computeQuote(input({ discountIrr: 100_000n }), rule(), fxAt('1920000')),
    );
    expect(discounted.components.find((c) => c.kind === 'DISCOUNT')?.amountIrr).toBe('-100000');
  });
});

/* ============================================================================
 * Simulator — must not be a second implementation
 * ==========================================================================*/

describe('SimulatorService', () => {
  const pricing = new PricingService();
  const simulator = new SimulatorService(pricing);

  const request = {
    skuId: 'sku_1',
    serviceId: null,
    supplierOfferId: null,
    quantity: 1,
    supplierCostForeign: '96.50',
    supplierCostCurrency: 'USD',
    marketFxRate: '1920000',
    rule: {
      id: 'rule_base',
      name: 'POC global',
      version: 1,
      fxSpreadBps: 150,
      fxRiskBufferBps: 100,
      serviceFeeBps: 200,
      serviceFeeFixedIrr: '20000',
      operationalFeeIrr: '50000',
      targetMarginBps: 400,
      minimumMarginIrr: '200000',
      paymentFeeBps: 150,
      paymentFeeFixedIrr: '5000',
      quoteTtlSeconds: 600,
      roundingStepIrr: '10000',
      maxSupplierCostToleranceBps: 500,
    },
  } as unknown as Parameters<SimulatorService['simulate']>[0];

  it('returns exactly what the customer quote path would charge', () => {
    const simulated = simulator.simulate(request);
    const direct = pricing.toWirePricingBreakdown(
      pricing.computeQuote(input({ supplierCostUsd: new Decimal('96.50') }), rule(), fxAt('1920000')),
    );

    // Same formula, same numbers — the simulator is an adapter, not a copy.
    expect(simulated.breakdown.finalAmountIrr).toBe(direct.finalAmountIrr);
    expect(simulated.breakdown.supplierCostIrr).toBe(direct.supplierCostIrr);
    expect(simulated.breakdown.contributionIrr).toBe(direct.contributionIrr);
    expect(simulated.breakdown.effectiveMarginBps).toBe(direct.effectiveMarginBps);
    expect(simulated.breakdown.components).toEqual(direct.components);
  });

  it('marks its synthetic FX snapshot as a manual override, never as observed', () => {
    const simulated = simulator.simulate(request);
    expect(simulated.fx?.provider).toBe('admin-simulator');
    expect(simulated.fx?.isManualOverride).toBe(true);
    expect(simulated.fx?.id).toBeNull();
    expect(simulated.fx?.midRate).toBe('1920000');
  });

  it('prices against a supplied live snapshot when one is given', () => {
    const live = fxAt('2000000');
    const simulated = simulator.simulate(request, live);
    expect(simulated.fx?.provider).toBe('primary-nav');
    expect(simulated.breakdown.effectiveFxRate).toBe('2050000');
  });

  it('applies a wire discount string as an exact bigint', () => {
    const simulated = simulator.simulate({
      ...request,
      discountIrr: '4230400',
    } as typeof request);
    expect(simulated.breakdown.discountAmount).toBe('4230400');
    expect(simulated.breakdown.finalAmountIrr).toBe('200000000');
  });

  it('refuses a non-USD supplier cost rather than pricing it at the USD rate', () => {
    expect(() =>
      simulator.simulate({ ...request, supplierCostCurrency: 'EUR' } as typeof request),
    ).toThrow(/Only USD supplier costs/u);
  });

  it('propagates an engine rejection instead of returning a plausible number', () => {
    expect(() =>
      simulator.simulate({
        ...request,
        rule: { ...request.rule, roundingStepIrr: '0' },
      } as typeof request),
    ).toThrow(/greater than zero/u);
  });
});
