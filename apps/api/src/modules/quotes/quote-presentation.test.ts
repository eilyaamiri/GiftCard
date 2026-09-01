import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';

import type {
  DecimalString,
  FxRateSnapshot,
  IrrString,
  PricingBreakdown as WirePricingBreakdown,
  PricingComponent,
} from '@barat/contracts';

import { PricingService } from '../pricing/pricing.service';
import type { PricingRule } from '../pricing/pricing.types';
import { toAudienceBreakdown, toQuoteSnapshotDto } from './quote-presentation';
import type { QuoteRow } from './quote-presentation';

/* ============================================================================
 * What this file pins
 *
 * Two properties of the CUSTOMER view, both load-bearing:
 *
 *   1. Every line is a whole number of Toman. Fees and margin are bps of a rial
 *      subtotal, so the stored components routinely land on an odd rial; the
 *      storefront's `formatToman` refuses a fraction of a Toman rather than
 *      truncate it, and used to take the whole quote page down with a 500.
 *   2. The lines still sum to `finalAmountIrr` exactly. Rounding each line
 *      without re-deriving the ROUNDING line would leave a breakdown that does
 *      not add up to the amount charged, which is worse than the crash.
 *
 * The STAFF view is verbatim and must stay that way — rounding an audit trail
 * is not rounding, it is losing evidence.
 * ==========================================================================*/

const IRR = 10n;

function sumOf(components: readonly PricingComponent[]): bigint {
  return components.reduce((total, component) => total + BigInt(component.amountIrr), 0n);
}

/* ---------------------------------------------------------------- fixtures */

/** A hand-built wire breakdown; only the fields the fold reads are meaningful. */
function wireBreakdown(
  components: ReadonlyArray<{ kind: PricingComponent['kind']; amountIrr: bigint }>,
  totals: { supplierCostIrr: bigint; marginAmount: bigint; finalAmountIrr: bigint },
): WirePricingBreakdown {
  return {
    pricingVersion: 1,
    ruleId: 'rule_base',
    marketFxRate: '900000' as DecimalString,
    effectiveFxRate: '922500' as DecimalString,
    fxProvider: 'primary-nav',
    fxRateTimestamp: '2026-08-30T12:00:00.000Z',
    fxSpreadAmount: '1350000' as IrrString,
    fxRiskBufferAmount: '900000' as IrrString,
    supplierCostForeign: '97.30' as DecimalString,
    supplierCostCurrency: 'USD',
    supplierCostIrr: totals.supplierCostIrr.toString() as IrrString,
    paymentFee: '871755' as IrrString,
    serviceFee: '1743527' as IrrString,
    operationalFee: '0' as IrrString,
    marginAmount: totals.marginAmount.toString() as IrrString,
    marginFloorApplied: false,
    discountAmount: '0' as IrrString,
    subtotal: '92406825' as IrrString,
    roundingAdjustment: '3175' as IrrString,
    finalAmountIrr: totals.finalAmountIrr.toString() as IrrString,
    displayAmountToman: (totals.finalAmountIrr / IRR).toString() as IrrString,
    contributionIrr: '0' as IrrString,
    effectiveMarginBps: 400,
    components: components.map((component, sortOrder) => ({
      kind: component.kind,
      label: component.kind,
      labelFa: component.kind,
      amountIrr: component.amountIrr.toString() as IrrString,
      amountForeign: null,
      currency: null,
      bps: null,
      sortOrder,
    })),
  };
}

/* ============================================================================
 * The fold, on numbers checked by hand
 * ==========================================================================*/

describe('toAudienceBreakdown / CUSTOMER lines are whole Toman', () => {
  /*
   * goods    89,791,543 rial -> 8,979,154.3 T  -> rounds down to  89,791,540
   * payment     871,755 rial ->     87,175.5 T -> half, away from 0: 871,760
   * service   1,743,527 rial ->    174,352.7 T -> rounds up to      1,743,530
   * operational       0 rial -> dropped, a customer is not shown a zero line
   * ---------------------------------------------------------------------
   * accounted                                                   92,406,830
   * final                                                       92,410,000
   * rounding line = final - accounted =                              3,170
   */
  const breakdown = wireBreakdown(
    [
      { kind: 'SUPPLIER_COST', amountIrr: 86_337_060n },
      { kind: 'FX_SPREAD', amountIrr: 1_350_000n },
      { kind: 'FX_RISK_BUFFER', amountIrr: 900_000n },
      { kind: 'PAYMENT_FEE', amountIrr: 871_755n },
      { kind: 'SERVICE_FEE', amountIrr: 1_743_527n },
      { kind: 'OPERATIONAL_FEE', amountIrr: 0n },
      { kind: 'MARGIN', amountIrr: 3_454_483n },
      { kind: 'ROUNDING', amountIrr: 3_175n },
    ],
    { supplierCostIrr: 86_337_060n, marginAmount: 3_454_483n, finalAmountIrr: 92_410_000n },
  );

  const customer = toAudienceBreakdown(breakdown, 'CUSTOMER', '97.30', 'USD');

  it('emits one folded goods line plus the fees the customer is charged', () => {
    expect(
      customer.components.map((component) => [component.kind, component.amountIrr]),
    ).toEqual([
      ['SUPPLIER_COST', '89791540'],
      ['PAYMENT_FEE', '871760'],
      ['SERVICE_FEE', '1743530'],
      ['ROUNDING', '3170'],
    ]);
  });

  it('sums to the amount that will actually be charged', () => {
    expect(sumOf(customer.components)).toBe(BigInt(customer.finalAmountIrr));
  });

  it('carries the foreign face value on the goods line only', () => {
    expect(customer.components[0]).toMatchObject({ amountForeign: '97.30', currency: 'USD' });
    for (const component of customer.components.slice(1)) {
      expect(component.amountForeign).toBeNull();
      expect(component.currency).toBeNull();
    }
  });

  it('never re-publishes the supplier cost, spread, buffer or margin as lines', () => {
    const kinds = customer.components.map((component) => component.kind);
    expect(kinds).not.toContain('FX_SPREAD');
    expect(kinds).not.toContain('FX_RISK_BUFFER');
    expect(kinds).not.toContain('MARGIN');
    expect(kinds.filter((kind) => kind === 'SUPPLIER_COST')).toHaveLength(1);
  });

  it('leaves the STAFF view verbatim, odd rial and all', () => {
    const staff = toAudienceBreakdown(breakdown, 'STAFF', '97.30', 'USD');
    expect(staff).toBe(breakdown);
    expect(staff.components.map((component) => component.amountIrr)).toContain('871755');
  });
});

describe('toAudienceBreakdown / a discount stays negative through the rounding', () => {
  /*
   * A discount is the one negative line, and it must round AWAY from zero on a
   * half like every other line — rounding it toward zero would hand the
   * customer a different discount than the one the rounding line then has to
   * reconcile against.
   *
   * goods    50,000,004 -> 50,000,000
   * discount -5,000,005 -> -5,000,010
   * accounted            44,999,990   final 45,000,000   rounding 10
   */
  const breakdown = wireBreakdown(
    [
      { kind: 'SUPPLIER_COST', amountIrr: 48_000_004n },
      { kind: 'MARGIN', amountIrr: 2_000_000n },
      { kind: 'DISCOUNT', amountIrr: -5_000_005n },
      { kind: 'ROUNDING', amountIrr: 5n },
    ],
    { supplierCostIrr: 48_000_004n, marginAmount: 2_000_000n, finalAmountIrr: 45_000_000n },
  );

  const customer = toAudienceBreakdown(breakdown, 'CUSTOMER', '50', 'USD');

  it('keeps the discount as a single negative line', () => {
    expect(
      customer.components.map((component) => [component.kind, component.amountIrr]),
    ).toEqual([
      ['SUPPLIER_COST', '50000000'],
      ['DISCOUNT', '-5000010'],
      ['ROUNDING', '10'],
    ]);
    expect(sumOf(customer.components)).toBe(45_000_000n);
  });
});

describe('toAudienceBreakdown / no rounding line when nothing is left over', () => {
  const breakdown = wireBreakdown(
    [
      { kind: 'SUPPLIER_COST', amountIrr: 40_000_000n },
      { kind: 'MARGIN', amountIrr: 2_000_000n },
      { kind: 'ROUNDING', amountIrr: 0n },
    ],
    { supplierCostIrr: 40_000_000n, marginAmount: 2_000_000n, finalAmountIrr: 42_000_000n },
  );

  it('shows the goods line alone', () => {
    const customer = toAudienceBreakdown(breakdown, 'CUSTOMER', '42', 'USD');
    expect(customer.components.map((component) => component.kind)).toEqual(['SUPPLIER_COST']);
    expect(sumOf(customer.components)).toBe(42_000_000n);
  });
});

/* ============================================================================
 * The same two properties against the real pricing engine
 *
 * The fixtures above prove the arithmetic; this proves the fold survives
 * whatever the engine actually produces, including the fractional-rial fees
 * that caused the original 500.
 * ==========================================================================*/

describe('toAudienceBreakdown / against computeQuote output', () => {
  const pricing = new PricingService();

  const rule: PricingRule = Object.freeze({
    id: 'rule_base',
    name: 'POC global',
    version: 1,
    fxSpreadBps: 150,
    fxRiskBufferBps: 100,
    serviceFeeBps: 200,
    serviceFeeFixedIrr: 20_000n,
    operationalFeeIrr: 50_000n,
    targetMarginBps: 400,
    minimumMarginIrr: 200_000n,
    paymentFeeBps: 150,
    paymentFeeFixedIrr: 5_000n,
    quoteTtlSeconds: 600,
    roundingStepIrr: 10_000n,
    maxSupplierCostToleranceBps: 500,
  });

  function fxAt(midRate: string): FxRateSnapshot {
    const at = '2026-08-30T12:00:00.000Z';
    return {
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
    } as FxRateSnapshot;
  }

  const cases: ReadonlyArray<{
    readonly usd: string;
    readonly quantity: number;
    readonly rate: string;
    readonly discountIrr?: bigint;
  }> = [
    { usd: '96.50', quantity: 1, rate: '1920000' },
    { usd: '10', quantity: 3, rate: '917333' },
    { usd: '99.99', quantity: 7, rate: '1234567' },
    { usd: '25.37', quantity: 2, rate: '888881' },
    { usd: '50', quantity: 1, rate: '1000003', discountIrr: 1_234_567n },
  ];

  for (const testCase of cases) {
    const label = `${testCase.usd} USD x${testCase.quantity} @ ${testCase.rate}`;

    it(`states every line in whole Toman and still sums to the total (${label})`, () => {
      const wire = pricing.toWirePricingBreakdown(
        pricing.computeQuote(
          {
            supplierCostUsd: new Decimal(testCase.usd),
            quantity: testCase.quantity,
            ...(testCase.discountIrr === undefined ? {} : { discountIrr: testCase.discountIrr }),
          },
          rule,
          fxAt(testCase.rate),
        ),
      );

      const customer = toAudienceBreakdown(wire, 'CUSTOMER', testCase.usd, 'USD');

      for (const component of customer.components) {
        expect(BigInt(component.amountIrr) % IRR).toBe(0n);
      }
      expect(sumOf(customer.components)).toBe(BigInt(wire.finalAmountIrr));
      /* Folding must not change what is owed. */
      expect(customer.finalAmountIrr).toBe(wire.finalAmountIrr);
    });
  }
});

/* ============================================================================
 * The persisted-row path
 * ==========================================================================*/

describe('toQuoteSnapshotDto / CUSTOMER', () => {
  function decimal(value: string): { toFixed(dp?: number): string } {
    return { toFixed: (dp = 6) => new Decimal(value).toFixed(dp) };
  }

  const row: QuoteRow = {
    id: 'quote_1',
    quoteNumber: 'BQ-2026-000001',
    customerId: 'customer_1',
    commerceSessionId: null,
    cartId: null,
    skuId: 'sku_1',
    serviceId: null,
    supplierOfferId: 'offer_1',
    quantity: 1,
    currency: 'USD',
    pricingRuleId: 'rule_base',
    pricingVersion: 1,
    marketFxRate: decimal('900000'),
    effectiveFxRate: decimal('922500'),
    fxProvider: 'primary-nav',
    fxRateId: 'fx_1',
    fxRateTimestamp: new Date('2026-08-30T12:00:00.000Z'),
    fxSpreadAmount: 1_350_000n,
    fxRiskBufferAmount: 900_000n,
    supplierCostUsd: decimal('97.30'),
    supplierCostIrr: 86_337_060n,
    paymentFee: 871_755n,
    serviceFee: 1_743_527n,
    operationalFee: 0n,
    marginAmount: 3_454_483n,
    discountAmount: 0n,
    subtotal: 92_406_825n,
    finalAmountIrr: 92_410_000n,
    displayAmountToman: 9_241_000n,
    status: 'ACTIVE',
    expiresAt: new Date('2026-08-30T12:10:00.000Z'),
    acceptedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-08-30T12:00:00.000Z'),
    snapshot: { customerForeignAmount: '100' },
    components: [
      { kind: 'SUPPLIER_COST', label: 'Supplier cost', labelFa: 'بهای تأمین', amountIrr: 86_337_060n, amountForeign: decimal('97.30'), currency: 'USD', bps: null, sortOrder: 0 },
      { kind: 'FX_SPREAD', label: 'FX spread', labelFa: 'اسپرد ارز', amountIrr: 1_350_000n, amountForeign: null, currency: null, bps: 150, sortOrder: 1 },
      { kind: 'FX_RISK_BUFFER', label: 'FX buffer', labelFa: 'حاشیه ریسک', amountIrr: 900_000n, amountForeign: null, currency: null, bps: 100, sortOrder: 2 },
      { kind: 'PAYMENT_FEE', label: 'Payment fee', labelFa: 'کارمزد پرداخت', amountIrr: 871_755n, amountForeign: null, currency: null, bps: 150, sortOrder: 3 },
      { kind: 'SERVICE_FEE', label: 'Service fee', labelFa: 'کارمزد خدمات', amountIrr: 1_743_527n, amountForeign: null, currency: null, bps: 200, sortOrder: 4 },
      { kind: 'OPERATIONAL_FEE', label: 'Operational fee', labelFa: 'هزینه عملیاتی', amountIrr: 0n, amountForeign: null, currency: null, bps: null, sortOrder: 5 },
      { kind: 'MARGIN', label: 'Margin', labelFa: 'حاشیه سود', amountIrr: 3_454_483n, amountForeign: null, currency: null, bps: 400, sortOrder: 6 },
      { kind: 'ROUNDING', label: 'Rounding', labelFa: 'گرد کردن', amountIrr: 3_175n, amountForeign: null, currency: null, bps: null, sortOrder: 7 },
    ],
  };

  const now = new Date('2026-08-30T12:01:00.000Z');

  it('renders the stored quote as whole-Toman lines that sum to the total', () => {
    const dto = toQuoteSnapshotDto(row, 'CUSTOMER', now);

    expect(
      dto.components.map((component) => [component.labelFa, component.amountIrr]),
    ).toEqual([
      ['بهای کالا', '89791540'],
      ['کارمزد پرداخت', '871760'],
      ['کارمزد خدمات', '1743530'],
      ['تعدیل گرد کردن', '3170'],
    ]);
    expect(sumOf(dto.components)).toBe(BigInt(dto.finalAmountIrr));
  });

  it('shows the face value the customer is buying, not the supplier cost', () => {
    const dto = toQuoteSnapshotDto(row, 'CUSTOMER', now);
    expect(dto.supplierCostUsd).toBe('100');
    expect(dto.supplierOfferId).toBeNull();
    expect(dto.pricingRuleId).toBeNull();
    expect(dto.marginAmount).toBe('0');
    expect(JSON.stringify(dto)).not.toContain('97.3');
  });

  it('keeps the STAFF components verbatim', () => {
    const dto = toQuoteSnapshotDto(row, 'STAFF', now);
    expect(dto.components).toHaveLength(row.components.length);
    expect(dto.components.map((component) => component.amountIrr)).toContain('871755');
    expect(dto.components.map((component) => component.kind)).toContain('MARGIN');
  });
});
