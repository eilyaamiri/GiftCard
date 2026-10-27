import { z } from 'zod';

import { quoteStatusSchema } from '../enums/commerce';
import {
  positiveDecimalStringSchema,
  positiveIrrStringSchema,
  irrStringSchema,
  strictlyPositiveDecimalStringSchema,
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

  /* What is being priced — exactly one of these three is set. */
  skuId: idSchema.nullable(),
  serviceId: idSchema.nullable(),
  topUpOfferId: idSchema.nullable(),
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

/**
 * Caps on the free-form maps a public, unauthenticated endpoint accepts. They
 * end up in the quote snapshot and the order, so an unbounded map is unbounded
 * storage paid for by nobody. The field definitions validate the content; this
 * only bounds the shape.
 */
export const QUOTE_FIELD_MAP_MAX_KEYS = 20;
export const QUOTE_FIELD_KEY_MAX_LENGTH = 64;
export const QUOTE_FIELD_VALUE_MAX_LENGTH = 512;

const quoteFieldMapSchema = z
  .record(
    z.string().min(1).max(QUOTE_FIELD_KEY_MAX_LENGTH),
    z.string().max(QUOTE_FIELD_VALUE_MAX_LENGTH),
  )
  .refine(
    (fields) => Object.keys(fields).length <= QUOTE_FIELD_MAP_MAX_KEYS,
    `At most ${QUOTE_FIELD_MAP_MAX_KEYS} fields are accepted`,
  );

export const createQuoteRequestSchema = z
  .object({
    skuId: idSchema.optional(),
    serviceId: idSchema.optional(),
    /**
     * The third target kind: a direct top-up. The customer names the offer they
     * picked, and the account it should be credited to travels in
     * `topUpAccountFields`.
     */
    topUpOfferId: idSchema.optional(),
    quantity: z.number().int().min(1).max(100).default(1),

    /**
     * For international payments the customer states the foreign amount they
     * need to pay. For gift cards the amount comes from the SKU face value.
     */
    requestedAmountForeign: strictlyPositiveDecimalStringSchema.optional(),
    /**
     * Optional. When absent the currency is read from the catalog item being
     * bought; when present it must match it. There is deliberately no default:
     * a default of USD made every pound or euro card fail for a client that
     * simply left the field out.
     */
    currency: z.string().regex(/^[A-Z]{3}$/u).optional(),

    /** Free-form service inputs, validated against `ServiceFieldDefinition`. */
    serviceFields: quoteFieldMapSchema.optional(),

    /**
     * The game-account identifiers the supplier needs, e.g.
     * `{ player_id: '5001234567', server: 'asia' }`, validated against the
     * game's `TopUpField` rows.
     *
     * These are public account identifiers, not credentials. Games that want a
     * login are refused before they reach this schema, so no password is ever
     * accepted here or stored in the quote snapshot.
     */
    topUpAccountFields: quoteFieldMapSchema.optional(),

    cartId: idSchema.optional(),
    commerceSessionToken: commerceSessionTokenSchema.optional(),
    discountCode: z.string().max(64).optional(),
  })
  .refine(
    (value) =>
      [value.skuId, value.serviceId, value.topUpOfferId].filter((target) => target !== undefined)
        .length === 1,
    'Provide exactly one of skuId, serviceId or topUpOfferId',
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
