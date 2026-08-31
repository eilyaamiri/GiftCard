import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';

import { IRR_PER_TOMAN, type PricingBreakdown as WirePricingBreakdown } from '@barat/contracts';

import {
  applyBps,
  applyBpsToDecimal,
  decimalToIrr,
  decimalToPlainString,
  irrToToman,
  quantizeToScale,
  ratioToBps,
  roundUpToStep,
} from './money';
import type {
  FxRateSnapshot,
  PricingBreakdown,
  PricingComponent,
  PricingInput,
  PricingRule,
} from './pricing.types';

const FinancialDecimal = Decimal.clone({
  precision: 100,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -1_000,
  toExpPos: 1_000,
});

const BPS_FIELDS = [
  'fxSpreadBps',
  'fxRiskBufferBps',
  'serviceFeeBps',
  'targetMarginBps',
  'paymentFeeBps',
  'maxSupplierCostToleranceBps',
] as const satisfies readonly (keyof PricingRule)[];

const NON_NEGATIVE_IRR_FIELDS = [
  'serviceFeeFixedIrr',
  'operationalFeeIrr',
  'minimumMarginIrr',
  'paymentFeeFixedIrr',
] as const satisfies readonly (keyof PricingRule)[];

/**
 * THE Barat Pay pricing formula. There is no second copy of it anywhere — the
 * customer quote path and the admin simulator both land here.
 *
 *   effectiveFxRate = marketFxRate
 *                   + applyBps(marketFxRate, fxSpreadBps)
 *                   + applyBps(marketFxRate, fxRiskBufferBps)
 *   supplierCostIrr = floor(supplierCostUsd x quantity x effectiveFxRate)
 *   paymentFee      = applyBps(supplierCostIrr, paymentFeeBps) + paymentFeeFixedIrr
 *   serviceFee      = applyBps(supplierCostIrr, serviceFeeBps) + serviceFeeFixedIrr
 *   operationalFee  = operationalFeeIrr
 *   margin          = max(applyBps(supplierCostIrr, targetMarginBps), minimumMarginIrr)
 *   subtotal        = supplierCostIrr + paymentFee + serviceFee
 *                   + operationalFee + margin - discount
 *   finalAmountIrr  = roundUp(subtotal, roundingStepIrr)
 *
 * Two properties are load-bearing and must survive every future edit:
 *
 * 1. PURITY. No clock, no database, no environment, no provider call. The three
 *    arguments completely determine the result, which is what lets the admin
 *    simulator, the quote endpoint and the reconciliation replay all agree, and
 *    what lets a disputed order be recomputed years later from its snapshot.
 *
 * 2. NO FLOATS. Every rial is a `bigint`; every foreign amount is a `Decimal`.
 *
 * The spread and the risk buffer are both computed from the MARKET rate, not
 * compounded on top of each other: `market x (1 + s) x (1 + b)` would quietly
 * charge more than the configured `s + b` and make the published rule a lie.
 */
export function computeQuote(
  input: PricingInput,
  rule: PricingRule,
  fx: FxRateSnapshot,
): PricingBreakdown {
  validatePricingArguments(input, rule, fx);

  const unitSupplierCostUsd = new FinancialDecimal(input.supplierCostUsd.toString());
  const totalSupplierCostUsd = unitSupplierCostUsd.mul(input.quantity.toString());

  /*
   * The market observation is the snapshot MIDPOINT. buy/sell are retained on
   * the snapshot for provenance; picking one of them here would silently change
   * the economics whenever a provider widened its own spread.
   */
  const marketFxRate = quantizeToScale(new Decimal(fx.midRate));

  const fxSpreadRate = applyBpsToDecimal(marketFxRate, rule.fxSpreadBps);
  const fxRiskBufferRate = applyBpsToDecimal(marketFxRate, rule.fxRiskBufferBps);

  /*
   * Quantise to the database's Decimal(18,6) BEFORE pricing with it. The rate we
   * report is then exactly the rate we used — rule 4. Quantising afterwards
   * would publish a rate that cannot reproduce its own amount.
   */
  const rateAfterSpread = quantizeToScale(marketFxRate.plus(fxSpreadRate.toString()));
  const effectiveFxRate = quantizeToScale(
    marketFxRate.plus(fxSpreadRate.toString()).plus(fxRiskBufferRate.toString()),
  );

  /*
   * Incremental allocation: each FX line is the DIFFERENCE between two floored
   * IRR totals. Computing the lines independently and flooring each one would
   * leave the component list off by a rial or two from the amount charged, and
   * an audit trail that does not add up is not an audit trail.
   */
  const marketSupplierCostIrr = decimalToIrr(totalSupplierCostUsd, marketFxRate);
  const supplierCostAfterSpreadIrr = decimalToIrr(totalSupplierCostUsd, rateAfterSpread);
  const supplierCostIrr = decimalToIrr(totalSupplierCostUsd, effectiveFxRate);
  const fxSpreadAmount = supplierCostAfterSpreadIrr - marketSupplierCostIrr;
  const fxRiskBufferAmount = supplierCostIrr - supplierCostAfterSpreadIrr;

  const paymentFee = applyBps(supplierCostIrr, rule.paymentFeeBps) + rule.paymentFeeFixedIrr;
  const serviceFee = applyBps(supplierCostIrr, rule.serviceFeeBps) + rule.serviceFeeFixedIrr;
  const operationalFee = rule.operationalFeeIrr;

  const targetMargin = applyBps(supplierCostIrr, rule.targetMarginBps);
  const marginFloorApplied = targetMargin < rule.minimumMarginIrr;
  const marginAmount = marginFloorApplied ? rule.minimumMarginIrr : targetMargin;
  const discountAmount = input.discountIrr ?? 0n;

  const amountBeforeDiscount =
    supplierCostIrr + paymentFee + serviceFee + operationalFee + marginAmount;
  if (discountAmount > amountBeforeDiscount) {
    throw new RangeError('Discount may not make the quote subtotal negative');
  }

  const subtotal = amountBeforeDiscount - discountAmount;
  const finalAmountIrr = roundUpToStep(subtotal, rule.roundingStepIrr);
  const roundingAdjustment = finalAmountIrr - subtotal;
  const displayAmountToman = irrToToman(finalAmountIrr);

  /*
   * Contribution = actual customer revenue minus the variable costs of serving
   * the order. Supplier cost is taken at the EFFECTIVE rate, not the market
   * rate: the spread and risk buffer exist because we do not, in practice, buy
   * USD at mid. Booking them as profit here would flatter every profitability
   * report by exactly the amount we set aside to absorb rate movement.
   *
   * Service fee and margin are revenue and are therefore not subtracted.
   */
  const contributionIrr = finalAmountIrr - supplierCostIrr - paymentFee - operationalFee;
  const effectiveMarginBps =
    finalAmountIrr === 0n ? 0 : ratioToBps(contributionIrr, finalAmountIrr);

  const components: readonly PricingComponent[] = Object.freeze([
    { kind: 'SUPPLIER_COST', amountIrr: marketSupplierCostIrr, bps: null },
    { kind: 'FX_SPREAD', amountIrr: fxSpreadAmount, bps: rule.fxSpreadBps },
    { kind: 'FX_RISK_BUFFER', amountIrr: fxRiskBufferAmount, bps: rule.fxRiskBufferBps },
    { kind: 'PAYMENT_FEE', amountIrr: paymentFee, bps: rule.paymentFeeBps },
    { kind: 'SERVICE_FEE', amountIrr: serviceFee, bps: rule.serviceFeeBps },
    { kind: 'OPERATIONAL_FEE', amountIrr: operationalFee, bps: null },
    { kind: 'MARGIN', amountIrr: marginAmount, bps: rule.targetMarginBps },
    { kind: 'DISCOUNT', amountIrr: -discountAmount, bps: null },
    { kind: 'ROUNDING', amountIrr: roundingAdjustment, bps: null },
  ] as const satisfies readonly PricingComponent[]);

  return Object.freeze({
    pricingVersion: rule.version,
    ruleId: rule.id,
    /* The snapshot is copied verbatim so the caller cannot mutate our record. */
    fxSnapshotUsed: Object.freeze({ ...fx }),

    marketFxRate: decimalToPlainString(marketFxRate),
    effectiveFxRate: decimalToPlainString(effectiveFxRate),
    fxSpreadAmount,
    fxRiskBufferAmount,

    supplierCostUsd: decimalToPlainString(unitSupplierCostUsd),
    totalSupplierCostUsd: decimalToPlainString(totalSupplierCostUsd),
    quantity: input.quantity,
    marketSupplierCostIrr,
    supplierCostIrr,

    paymentFee,
    serviceFee,
    operationalFee,
    marginAmount,
    marginFloorApplied,
    discountAmount,

    subtotal,
    roundingAdjustment,
    finalAmountIrr,
    displayAmountToman,

    contributionIrr,
    effectiveMarginBps,
    components,
  });
}

/** English/Persian labels for the auditable component lines, in display order. */
const COMPONENT_LABELS = {
  SUPPLIER_COST: ['Supplier cost', 'هزینه تأمین'],
  FX_SPREAD: ['FX spread', 'اسپرد نرخ ارز'],
  FX_RISK_BUFFER: ['FX risk buffer', 'ذخیره ریسک نرخ ارز'],
  PAYMENT_FEE: ['Payment fee', 'کارمزد پرداخت'],
  SERVICE_FEE: ['Service fee', 'کارمزد خدمات'],
  OPERATIONAL_FEE: ['Operational fee', 'هزینه عملیاتی'],
  MARGIN: ['Margin', 'حاشیه سود'],
  DISCOUNT: ['Discount', 'تخفیف'],
  ROUNDING: ['Rounding', 'تعدیل گرد کردن'],
} as const;

/**
 * The injectable facade over the pure function.
 *
 * It holds no state and makes no decisions; it exists so that Nest consumers
 * (quotes, the simulator, reconciliation) share one provider and so that the
 * bigint -> string boundary conversion has exactly one implementation.
 */
@Injectable()
export class PricingService {
  computeQuote(input: PricingInput, rule: PricingRule, fx: FxRateSnapshot): PricingBreakdown {
    return computeQuote(input, rule, fx);
  }

  /**
   * Project the internal breakdown onto the wire DTO.
   *
   * This is the ONLY place a rial amount becomes a string. JSON has no bigint,
   * so every IRR field crosses as a digit string; doing the conversion in one
   * function means no endpoint can accidentally ship a `Number`.
   */
  toWirePricingBreakdown(breakdown: PricingBreakdown): WirePricingBreakdown {
    const irr = <TField extends string>(value: bigint): TField => value.toString() as TField;

    return {
      pricingVersion: breakdown.pricingVersion,
      ruleId: breakdown.ruleId,

      marketFxRate: breakdown.marketFxRate as WirePricingBreakdown['marketFxRate'],
      effectiveFxRate: breakdown.effectiveFxRate as WirePricingBreakdown['effectiveFxRate'],
      fxProvider: breakdown.fxSnapshotUsed.provider,
      fxRateTimestamp: breakdown.fxSnapshotUsed.effectiveAt,
      fxSpreadAmount: irr(breakdown.fxSpreadAmount),
      fxRiskBufferAmount: irr(breakdown.fxRiskBufferAmount),

      supplierCostForeign:
        breakdown.supplierCostUsd as WirePricingBreakdown['supplierCostForeign'],
      supplierCostCurrency: 'USD',
      supplierCostIrr: irr(breakdown.supplierCostIrr),

      paymentFee: irr(breakdown.paymentFee),
      serviceFee: irr(breakdown.serviceFee),
      operationalFee: irr(breakdown.operationalFee),
      marginAmount: irr(breakdown.marginAmount),
      marginFloorApplied: breakdown.marginFloorApplied,
      discountAmount: irr(breakdown.discountAmount),

      subtotal: irr(breakdown.subtotal),
      roundingAdjustment: irr(breakdown.roundingAdjustment),
      finalAmountIrr: irr(breakdown.finalAmountIrr),
      displayAmountToman: irr(breakdown.displayAmountToman),

      contributionIrr: irr(breakdown.contributionIrr),
      effectiveMarginBps: breakdown.effectiveMarginBps,

      components: breakdown.components.map((component, sortOrder) => ({
        kind: component.kind,
        label: COMPONENT_LABELS[component.kind][0],
        labelFa: COMPONENT_LABELS[component.kind][1],
        amountIrr: irr(component.amountIrr),
        amountForeign:
          component.kind === 'SUPPLIER_COST'
            ? (breakdown.totalSupplierCostUsd as NonNullable<
                WirePricingBreakdown['components'][number]['amountForeign']
              >)
            : null,
        currency: component.kind === 'SUPPLIER_COST' ? 'USD' : null,
        bps: component.bps,
        sortOrder,
      })),
    };
  }
}

/**
 * Reject an impossible input before any arithmetic runs.
 *
 * These are assertions about our own data, not user validation — the Zod
 * contract schemas already ran at the HTTP edge. They exist because a pricing
 * bug that throws is recoverable and a pricing bug that returns a plausible
 * wrong number is not.
 */
function validatePricingArguments(
  input: PricingInput,
  rule: PricingRule,
  fx: FxRateSnapshot,
): void {
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) {
    throw new RangeError('Quantity must be a positive safe integer');
  }
  if (!input.supplierCostUsd.isFinite() || input.supplierCostUsd.lessThan(0)) {
    throw new RangeError('Supplier cost must be a finite non-negative Decimal');
  }
  if (input.discountIrr !== undefined && input.discountIrr < 0n) {
    throw new RangeError('Discount may not be negative');
  }
  if (!Number.isSafeInteger(rule.version) || rule.version < 1) {
    throw new RangeError('Pricing rule version must be a positive safe integer');
  }

  for (const field of BPS_FIELDS) {
    const value = rule[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${field} must be a non-negative safe integer`);
    }
  }
  for (const field of NON_NEGATIVE_IRR_FIELDS) {
    const value = rule[field];
    if (typeof value !== 'bigint' || value < 0n) {
      throw new RangeError(`${field} must be a non-negative bigint`);
    }
  }

  if (typeof rule.roundingStepIrr !== 'bigint' || rule.roundingStepIrr <= 0n) {
    throw new RangeError('roundingStepIrr must be greater than zero');
  }
  /*
   * Prices are shown to Iranians in Toman. A rounding step that is not a whole
   * Toman produces a final amount that `irrToToman` will refuse to convert, so
   * the misconfiguration is caught here with a message that names the field
   * rather than deep inside the display conversion.
   */
  if (rule.roundingStepIrr % IRR_PER_TOMAN !== 0n) {
    throw new RangeError(
      `roundingStepIrr must be a whole Toman (a multiple of ${IRR_PER_TOMAN.toString()} IRR)`,
    );
  }

  /*
   * Rule 4 of the FX policy: a stale rate never prices a new quote. The
   * aggregator decides what "stale" means; the engine simply refuses to be the
   * place where an expired rate slips through.
   */
  if (fx.isStale) {
    throw new RangeError('A stale FX snapshot cannot be used for pricing');
  }

  /*
   * `isPositive()` is the wrong predicate here: decimal.js treats zero as
   * positively signed, so a zero midpoint would pass and price every order at
   * nothing. Compare against zero explicitly.
   */
  const marketRate = new FinancialDecimal(fx.midRate);
  if (!marketRate.isFinite() || marketRate.lessThanOrEqualTo(0)) {
    throw new RangeError('FX midpoint must be a finite positive Decimal');
  }
}
