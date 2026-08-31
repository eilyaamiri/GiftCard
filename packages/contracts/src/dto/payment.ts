import { z } from 'zod';

import {
  paymentAmountUnitSchema,
  paymentFailureReasonSchema,
  paymentStatusSchema,
} from '../enums/commerce';
import { positiveIrrStringSchema } from '../money/schemas';
import { idSchema, idempotencyKeySchema, isoDateTimeSchema } from './common';

/* ============================================================================
 * Payment DTO
 * ==========================================================================*/

/**
 * The customer-safe view of a payment.
 *
 * Deliberately absent: merchant id, provider authority, raw provider payloads,
 * card number, any token. `providerRefId` is included because the customer needs
 * it to talk to their bank; `maskedCard` is already masked at write time.
 */
export const paymentDtoSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  provider: z.string().min(1),
  status: paymentStatusSchema,
  amountIrr: positiveIrrStringSchema,
  displayAmountToman: positiveIrrStringSchema,
  /** Bank reference number ("شماره پیگیری"), shown after a successful payment. */
  providerRefId: z.string().nullable(),
  maskedCard: z.string().nullable(),
  failureReason: paymentFailureReasonSchema.nullable(),
  requestedAt: isoDateTimeSchema.nullable(),
  redirectedAt: isoDateTimeSchema.nullable(),
  callbackAt: isoDateTimeSchema.nullable(),
  verifiedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type PaymentDto = z.infer<typeof paymentDtoSchema>;

/* ============================================================================
 * POST /api/payments  — createPayment
 * ==========================================================================*/

/**
 * Starts a payment for an order. Idempotent (rule 9): the same key returns the
 * same payment and the same redirect URL rather than opening a second session.
 *
 * The amount is NEVER taken from the request — it is read from the order, which
 * copied it from the immutable quote.
 */
export const createPaymentRequestSchema = z.object({
  orderId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  /** Optional override of the configured callback, whitelisted server-side. */
  returnPath: z
    .string()
    .max(255)
    .regex(/^\/[A-Za-z0-9\-._~/?=&%]*$/u, 'returnPath must be a relative path')
    .optional(),
});
export type CreatePaymentRequest = z.infer<typeof createPaymentRequestSchema>;

export const createPaymentResponseSchema = z.object({
  payment: paymentDtoSchema,
  /** Where the browser must be sent. Always provider-hosted, never an iframe. */
  redirectUrl: z.string(),
  /** False when an existing payment session was reused. */
  created: z.boolean(),
});
export type CreatePaymentResponse = z.infer<typeof createPaymentResponseSchema>;

/* ============================================================================
 * Gateway callback  — untrusted input
 * ==========================================================================*/

/**
 * Raw callback query parameters.
 *
 * AGENTS.md rule 8: these values are UNTRUSTED. They identify which payment to
 * look at and nothing more. Whether the payment succeeded is decided solely by a
 * server-to-server verify call.
 */
export const paymentCallbackQuerySchema = z.object({
  Authority: z.string().min(1).max(128).optional(),
  authority: z.string().min(1).max(128).optional(),
  Status: z.string().max(32).optional(),
  status: z.string().max(32).optional(),
});
export type PaymentCallbackQuery = z.infer<typeof paymentCallbackQuerySchema>;

/* ============================================================================
 * POST /api/payments/:id/verify  — verifyPayment
 * ==========================================================================*/

/**
 * Server-side verification. Idempotent: calling it five times must produce one
 * paid payment, one order transition and exactly one work item.
 */
export const verifyPaymentRequestSchema = z.object({
  paymentId: idSchema.optional(),
  /** Provider-side identifier from the callback, used when `paymentId` is absent. */
  providerAuthority: z.string().min(1).max(128).optional(),
  provider: z.string().min(1).optional(),
  idempotencyKey: idempotencyKeySchema,
});
export type VerifyPaymentRequest = z.infer<typeof verifyPaymentRequestSchema>;

export const verifyPaymentResponseSchema = z.object({
  payment: paymentDtoSchema,
  orderId: idSchema,
  /** Terminal outcome for the UI. `UNKNOWN` routes to manual reconciliation. */
  outcome: z.enum(['PAID', 'FAILED', 'CANCELLED', 'ALREADY_VERIFIED', 'UNKNOWN']),
  /** True when this call performed the verification (false on replay). */
  verified: z.boolean(),
  /** Safe Persian sentence for the payment-result page. */
  messageFa: z.string(),
});
export type VerifyPaymentResponse = z.infer<typeof verifyPaymentResponseSchema>;

/* ============================================================================
 * Provider-facing shapes (integrations layer)
 * ==========================================================================*/

/**
 * What the domain hands to a `RialPaymentProvider`. Provider-agnostic on purpose:
 * `orders` never knows ZarinPal exists (rules 5-7).
 */
export const paymentProviderRequestSchema = z.object({
  amountIrr: positiveIrrStringSchema,
  amountUnit: paymentAmountUnitSchema,
  orderNumber: z.string().min(1),
  description: z.string().max(255),
  callbackUrl: z.string(),
  /** Masked or hashed before it ever reaches a log. */
  customerMobile: z.string().nullable(),
  customerEmail: z.string().nullable(),
  idempotencyKey: idempotencyKeySchema,
});
export type PaymentProviderRequest = z.infer<typeof paymentProviderRequestSchema>;

export const paymentProviderResultSchema = z.object({
  status: paymentStatusSchema,
  providerAuthority: z.string().nullable(),
  providerRefId: z.string().nullable(),
  providerCode: z.number().int().nullable(),
  providerAmount: z.string().nullable(),
  providerAmountUnit: paymentAmountUnitSchema.nullable(),
  providerFee: positiveIrrStringSchema.nullable(),
  providerFeeType: z.string().nullable(),
  maskedCard: z.string().nullable(),
  cardHash: z.string().nullable(),
  failureReason: paymentFailureReasonSchema.nullable(),
  redirectUrl: z.string().nullable(),
});
export type PaymentProviderResult = z.infer<typeof paymentProviderResultSchema>;
