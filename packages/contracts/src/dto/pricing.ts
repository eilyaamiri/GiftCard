import { z } from 'zod';

import {
  bpsSchema,
  irrStringSchema,
  positiveDecimalStringSchema,
  positiveIrrStringSchema,
  signedBpsSchema,
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

/** The simulator calls the same pure function; it never re-implements the formula. */
export const simulateQuoteRequestSchema = pricingInputSchema;
export type SimulateQuoteRequest = z.infer<typeof simulateQuoteRequestSchema>;

export const simulateQuoteResponseSchema = z.object({
  breakdown: pricingBreakdownSchema,
  fx: fxRateSnapshotSchema.nullable(),
});
export type SimulateQuoteResponse = z.infer<typeof simulateQuoteResponseSchema>;
