import { z } from 'zod';

import {
  bpsSchema,
  irrStringSchema,
  positiveDecimalStringSchema,
  positiveIrrStringSchema,
  signedBpsSchema,
  strictlyPositiveDecimalStringSchema,
} from '../money/schemas';
import { idSchema, isoDateTimeSchema } from './common';
import { fxRateSnapshotSchema } from './fx';

/* ============================================================================
 * PricingRule
 * ==========================================================================*/

/**
 * Every knob of the pricing formula. Nothing is hardcoded in the engine.
 *
 * The rule values used for a given quote are snapshotted into the quote, so a
 * later rule change can never retroactively alter a historical price.
 */
export const pricingRuleSnapshotSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  version: z.number().int().min(1),

  /** Spread added on top of the market rate, in bps. */
  fxSpreadBps: bpsSchema,
  /** Extra buffer against intra-TTL rate movement, in bps. */
  fxRiskBufferBps: bpsSchema,

  serviceFeeBps: bpsSchema,
  serviceFeeFixedIrr: positiveIrrStringSchema,

  operationalFeeIrr: positiveIrrStringSchema,

  targetMarginBps: bpsSchema,
  /** Margin floor. If the bps margin is lower, this wins. */
  minimumMarginIrr: positiveIrrStringSchema,

  paymentFeeBps: bpsSchema,
  paymentFeeFixedIrr: positiveIrrStringSchema,

  quoteTtlSeconds: z.number().int().min(30).max(3_600),
  /** Customer price is always rounded UP to a multiple of this. */
  roundingStepIrr: positiveIrrStringSchema,
  /** Supplier cost variance beyond this requires manager approval. */
  maxSupplierCostToleranceBps: bpsSchema,
});
export type PricingRuleSnapshot = z.infer<typeof pricingRuleSnapshotSchema>;

/* ============================================================================
 * Pricing rule limits (ORD-7)
 *
 * A rule change applies to every quote from the next second. These ceilings
 * stop a typo (50000 for 500) from repricing the shop; a change big enough to
 * matter but under them needs a second person's approval instead.
 * ==========================================================================*/

/** No spread, buffer, fee, margin or tolerance may exceed 50%. */
export const PRICING_RULE_MAX_BPS = 5_000;
/** A fixed fee or margin floor above 10,000,000 Toman per quote is a typo. */
export const PRICING_RULE_MAX_FIXED_IRR = 100_000_000n;
/** Rounding to more than 100,000 Toman would swamp the price. */
export const PRICING_RULE_MAX_ROUNDING_STEP_IRR = 1_000_000n;

/**
 * A change that moves any basis-point field by more than this (5 percentage
 * points), or a new rule that sets one above `PRICING_RULE_NEW_RULE_REVIEW_BPS`,
 * waits for a second approver.
 */
export const PRICING_RULE_LARGE_CHANGE_BPS = 500;
export const PRICING_RULE_NEW_RULE_REVIEW_BPS = 2_000;

export const PRICING_RULE_BPS_FIELDS = [
  'fxSpreadBps',
  'fxRiskBufferBps',
  'serviceFeeBps',
  'paymentFeeBps',
  'targetMarginBps',
  'maxSupplierCostToleranceBps',
] as const;

export const PRICING_RULE_FIXED_IRR_FIELDS = [
  'serviceFeeFixedIrr',
  'operationalFeeIrr',
  'paymentFeeFixedIrr',
  'minimumMarginIrr',
] as const;

/** The fields that exceed a hard ceiling, for a write boundary to refuse. */
export function pricingRuleLimitViolations(
  values: Pick<
    PricingRuleSnapshot,
    (typeof PRICING_RULE_BPS_FIELDS)[number] | (typeof PRICING_RULE_FIXED_IRR_FIELDS)[number] | 'roundingStepIrr'
  >,
): Array<{ path: string; message: string }> {
  const violations: Array<{ path: string; message: string }> = [];
  for (const field of PRICING_RULE_BPS_FIELDS) {
    if (values[field] > PRICING_RULE_MAX_BPS) {
      violations.push({ path: field, message: `Must not exceed ${PRICING_RULE_MAX_BPS} bps` });
    }
  }
  for (const field of PRICING_RULE_FIXED_IRR_FIELDS) {
    if (BigInt(values[field]) > PRICING_RULE_MAX_FIXED_IRR) {
      violations.push({ path: field, message: `Must not exceed ${PRICING_RULE_MAX_FIXED_IRR} IRR` });
    }
  }
  if (BigInt(values.roundingStepIrr) > PRICING_RULE_MAX_ROUNDING_STEP_IRR) {
    violations.push({
      path: 'roundingStepIrr',
      message: `Must not exceed ${PRICING_RULE_MAX_ROUNDING_STEP_IRR} IRR`,
    });
  }
  return violations;
}

/* ============================================================================
 * Pricing input
 * ==========================================================================*/

/**
 * Everything the pure pricing function needs. It reads nothing else — no clock,
 * no database, no provider. That is what makes it testable and what lets the
 * admin Quote Simulator call the exact same function.
 */
export const pricingInputSchema = z.object({
  /** Exactly one of skuId / serviceId is set. */
  skuId: idSchema.nullable(),
  serviceId: idSchema.nullable(),
  supplierOfferId: idSchema.nullable(),

  quantity: z.number().int().min(1).max(100),

  /** Unit cost we pay the supplier, in foreign currency. */
  supplierCostForeign: positiveDecimalStringSchema,
  supplierCostCurrency: z.string().regex(/^[A-Z]{3}$/u),

  /** Observed market rate; spread and buffer are applied by the engine. */
  marketFxRate: positiveDecimalStringSchema,

  rule: pricingRuleSnapshotSchema,

  /** Optional absolute discount in IRR, applied after fees and margin. */
  discountIrr: positiveIrrStringSchema.optional(),
  discountCode: z.string().max(64).nullable().optional(),
});
export type PricingInput = z.infer<typeof pricingInputSchema>;

/* ============================================================================
 * Pricing breakdown
 * ==========================================================================*/

/** The kinds of line the breakdown can contain, in presentation order. */
export const PRICING_COMPONENT_KIND_VALUES = [
  'SUPPLIER_COST',
  'FX_SPREAD',
  'FX_RISK_BUFFER',
  'PAYMENT_FEE',
  'SERVICE_FEE',
  'OPERATIONAL_FEE',
  'MARGIN',
  'DISCOUNT',
  'ROUNDING',
] as const;
export type PricingComponentKind = (typeof PRICING_COMPONENT_KIND_VALUES)[number];
export const pricingComponentKindSchema = z.enum(PRICING_COMPONENT_KIND_VALUES);

/** One auditable line of the calculation. */
export const pricingComponentSchema = z.object({
  kind: pricingComponentKindSchema,
  label: z.string().min(1),
  labelFa: z.string().min(1),
  /** Signed: DISCOUNT is negative, everything else is positive. */
  amountIrr: irrStringSchema,
  /** Present when the component originated in foreign currency. */
  amountForeign: positiveDecimalStringSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  /** The bps rate that produced the amount, when applicable. */
  bps: signedBpsSchema.nullable(),
  sortOrder: z.number().int().min(0),
});
export type PricingComponent = z.infer<typeof pricingComponentSchema>;

/**
 * The complete, auditable output of the pricing engine.
 *
 *   effectiveFxRate    = marketFxRate + fxSpread(bps) + fxRiskBuffer(bps)
 *   supplierCostIrr    = supplierCostForeign x effectiveFxRate x quantity
 *   subtotal           = supplierCostIrr + paymentFee + serviceFee
 *                      + operationalFee + margin - discount
 *   finalAmountIrr     = roundUp(subtotal, roundingStepIrr)
 *   displayAmountToman = finalAmountIrr / 10
 */
export const pricingBreakdownSchema = z.object({
  pricingVersion: z.number().int().min(1),
  ruleId: idSchema,

  /* FX */
  marketFxRate: positiveDecimalStringSchema,
  effectiveFxRate: positiveDecimalStringSchema,
  fxProvider: z.string().min(1),
  fxRateTimestamp: isoDateTimeSchema,
  fxSpreadAmount: irrStringSchema,
  fxRiskBufferAmount: irrStringSchema,

  /* Cost */
  supplierCostForeign: positiveDecimalStringSchema,
  supplierCostCurrency: z.string().regex(/^[A-Z]{3}$/u),
  supplierCostIrr: positiveIrrStringSchema,

  /* Fees and margin */
  paymentFee: positiveIrrStringSchema,
  serviceFee: positiveIrrStringSchema,
  operationalFee: positiveIrrStringSchema,
  marginAmount: irrStringSchema,
  /** True when `minimumMarginIrr` was applied instead of `targetMarginBps`. */
  marginFloorApplied: z.boolean(),
  discountAmount: positiveIrrStringSchema,

  /* Totals */
  subtotal: irrStringSchema,
  roundingAdjustment: positiveIrrStringSchema,
  finalAmountIrr: positiveIrrStringSchema,
  displayAmountToman: positiveIrrStringSchema,

  /* Derived economics, for the admin simulator and the profitability report. */
  contributionIrr: irrStringSchema,
  effectiveMarginBps: signedBpsSchema,

  components: z.array(pricingComponentSchema),
});
export type PricingBreakdown = z.infer<typeof pricingBreakdownSchema>;

/* ============================================================================
 * Admin quote simulator
 * ==========================================================================*/

/**
 * The simulator calls the same pure function; it never re-implements the formula.
 *
 * `customerForeignAmount` is what ONE unit is worth to the customer (a card's
 * face value) as opposed to what it costs us. Supplying it reproduces a real
 * SKU's quote; leaving it out prices a card whose face value equals its cost.
 */
export const simulateQuoteRequestSchema = pricingInputSchema.extend({
  customerForeignAmount: strictlyPositiveDecimalStringSchema.optional(),
});
export type SimulateQuoteRequest = z.infer<typeof simulateQuoteRequestSchema>;

export const simulateQuoteResponseSchema = z.object({
  breakdown: pricingBreakdownSchema,
  fx: fxRateSnapshotSchema.nullable(),
});
export type SimulateQuoteResponse = z.infer<typeof simulateQuoteResponseSchema>;
