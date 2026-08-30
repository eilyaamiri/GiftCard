import { z } from 'zod';

import { quoteStatusSchema } from '../enums/commerce';
import {
  positiveDecimalStringSchema,
  positiveIrrStringSchema,
  irrStringSchema,
} from '../money/schemas';
import { commerceSessionTokenSchema, idSchema, idempotencyKeySchema, isoDateTimeSchema } from './common';
import { fxRateSnapshotSchema } from './fx';
import { pricingBreakdownSchema, pricingComponentSchema, pricingRuleSnapshotSchema } from './pricing';

/* ============================================================================
 * Quote snapshot
 * ==========================================================================*/

/**
 * The immutable quote snapshot (AGENTS.md rule 11).
 *
 * Once checkout starts, nothing in here may change. It holds VALUES, not
 * references: if the FX rate, the pricing rule or the supplier offer changes
 * tomorrow, this quote still explains exactly how its price was reached.
 *
 * An expired quote is NEVER reused to recover an abandoned cart — a new quote
 * is generated at the current rate.
 */
export const quoteSnapshotSchema = z.object({
  id: idSchema,
  quoteNumber: z.string().min(1),

  customerId: idSchema.nullable(),
  commerceSessionId: idSchema.nullable(),
  cartId: idSchema.nullable(),

  /* What is being priced — exactly one of these two is set. */
  skuId: idSchema.nullable(),
  serviceId: idSchema.nullable(),
  supplierOfferId: idSchema.nullable(),
  quantity: z.number().int().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/u),

  /* Pricing provenance */
  pricingRuleId: idSchema.nullable(),
  pricingVersion: z.number().int().min(1),
  rule: pricingRuleSnapshotSchema.nullable(),

  /* FX snapshot — frozen at creation time */
  marketFxRate: positiveDecimalStringSchema,
  effectiveFxRate: positiveDecimalStringSchema,
  fxProvider: z.string().min(1),
  fxRateId: idSchema.nullable(),
  fxRateTimestamp: isoDateTimeSchema,
  fxSpreadAmount: irrStringSchema,
  fxRiskBufferAmount: irrStringSchema,

  /* Cost, fees, margin — every component persisted, none recomputed */
  supplierCostUsd: positiveDecimalStringSchema,
  supplierCostIrr: positiveIrrStringSchema,
  paymentFee: positiveIrrStringSchema,
  serviceFee: positiveIrrStringSchema,
  operationalFee: positiveIrrStringSchema,
  marginAmount: irrStringSchema,
  discountAmount: positiveIrrStringSchema,

  /* Totals */
  subtotal: irrStringSchema,
  finalAmountIrr: positiveIrrStringSchema,
  displayAmountToman: positiveIrrStringSchema,

  /* Lifecycle */
  status: quoteStatusSchema,
  expiresAt: isoDateTimeSchema,
  /** Seconds left at response time — drives the countdown in the UI. */
  remainingSeconds: z.number().int().min(0),
  acceptedAt: isoDateTimeSchema.nullable(),
  cancelledAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,

  components: z.array(pricingComponentSchema),
});
export type QuoteSnapshot = z.infer<typeof quoteSnapshotSchema>;

/* ============================================================================
 * POST /api/quotes  — createQuote
 * ==========================================================================*/

export const createQuoteRequestSchema = z
  .object({
    skuId: idSchema.optional(),
    serviceId: idSchema.optional(),
    quantity: z.number().int().min(1).max(100).default(1),

    /**
     * For international payments the customer states the foreign amount they
     * need to pay. For gift cards the amount comes from the SKU face value.
     */
    requestedAmountForeign: positiveDecimalStringSchema.optional(),
    currency: z.string().regex(/^[A-Z]{3}$/u).default('USD'),

    /** Free-form service inputs, validated against `ServiceFieldDefinition`. */
    serviceFields: z.record(z.string(), z.string()).optional(),

    cartId: idSchema.optional(),
    commerceSessionToken: commerceSessionTokenSchema.optional(),
    discountCode: z.string().max(64).optional(),
  })
  .refine(
    (value) => Boolean(value.skuId) !== Boolean(value.serviceId),
    'Provide exactly one of skuId or serviceId',
  );
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

export const createQuoteResponseSchema = z.object({
  quote: quoteSnapshotSchema,
  breakdown: pricingBreakdownSchema,
  fx: fxRateSnapshotSchema,
});
export type CreateQuoteResponse = z.infer<typeof createQuoteResponseSchema>;

/* ============================================================================
 * POST /api/quotes/:id/accept  — acceptQuote
 * ==========================================================================*/

/**
 * Accepting a quote is idempotent (rule 9): replaying the same key returns the
 * same already-accepted quote instead of failing or re-pricing.
 */
export const acceptQuoteRequestSchema = z.object({
  quoteId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  /**
   * The amount the customer saw. The server compares it to the stored quote and
   * refuses on mismatch — this catches a stale browser tab and any tampering.
   */
  acknowledgedAmountIrr: positiveIrrStringSchema,
  commerceSessionToken: commerceSessionTokenSchema.optional(),
});
export type AcceptQuoteRequest = z.infer<typeof acceptQuoteRequestSchema>;

export const acceptQuoteResponseSchema = z.object({
  quote: quoteSnapshotSchema,
  /** True when this call actually performed the transition (false on replay). */
  accepted: z.boolean(),
  /** Present when a re-quote is required because the quote had expired. */
  requoteRequired: z.boolean(),
});
export type AcceptQuoteResponse = z.infer<typeof acceptQuoteResponseSchema>;

/* ============================================================================
 * GET /api/quotes/:id
 * ==========================================================================*/

export const getQuoteResponseSchema = z.object({
  quote: quoteSnapshotSchema,
});
export type GetQuoteResponse = z.infer<typeof getQuoteResponseSchema>;
