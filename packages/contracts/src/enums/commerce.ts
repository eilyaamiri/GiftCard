import { z } from 'zod';

import { enumFrom } from '../internal/enum-utils';

/* ============================================================================
 * Order
 * ==========================================================================*/

/**
 * The complete order state machine. No free-form status strings are allowed
 * anywhere in the system.
 *
 * Happy path:
 *   DRAFT -> AWAITING_PAYMENT -> PAYMENT_PENDING -> PAID
 *         -> FULFILLMENT_PENDING -> FULFILLING -> FULFILLED
 */
export const ORDER_STATUS_VALUES = [
  'DRAFT',
  'AWAITING_PAYMENT',
  'PAYMENT_PENDING',
  'PAID',
  'FULFILLMENT_PENDING',
  'FULFILLING',
  'FULFILLED',
  'FAILED',
  'REVIEW_REQUIRED',
  'REFUND_PENDING',
  'REFUNDED',
  'CANCELLED',
] as const;

export const OrderStatus = enumFrom(ORDER_STATUS_VALUES);
export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];
export const orderStatusSchema = z.enum(ORDER_STATUS_VALUES);

/** Statuses from which no further transition is allowed. */
export const ORDER_TERMINAL_STATUSES = ['FULFILLED', 'REFUNDED', 'CANCELLED'] as const;
export type OrderTerminalStatus = (typeof ORDER_TERMINAL_STATUSES)[number];

/* ============================================================================
 * Payment
 * ==========================================================================*/

/**
 * `UNKNOWN` is deliberate: a gateway timeout after redirect leaves us unable to
 * assert paid or failed. Such payments go to reconciliation, never to auto-refund.
 */
export const PAYMENT_STATUS_VALUES = [
  'CREATED',
  'REDIRECTED',
  'PENDING',
  'PAID',
  'FAILED',
  'CANCELLED',
  'UNKNOWN',
  'REFUND_PENDING',
  'REFUNDED',
] as const;

export const PaymentStatus = enumFrom(PAYMENT_STATUS_VALUES);
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];
export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES);

/**
 * Why a payment did not complete. These are OUR normalised reasons; a raw
 * provider message is never surfaced to the customer (it can leak merchant data).
 */
export const PAYMENT_FAILURE_REASON_VALUES = [
  'CUSTOMER_CANCELLED',
  'REQUEST_REJECTED',
  'VERIFY_FAILED',
  'INVALID_AUTHORITY',
  'AMOUNT_MISMATCH',
  'PROVIDER_TIMEOUT',
  'PROVIDER_NETWORK_ERROR',
  'PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH',
  'UNKNOWN_PROVIDER_RESPONSE',
] as const;

export const PaymentFailureReason = enumFrom(PAYMENT_FAILURE_REASON_VALUES);
export type PaymentFailureReason = (typeof PAYMENT_FAILURE_REASON_VALUES)[number];
export const paymentFailureReasonSchema = z.enum(PAYMENT_FAILURE_REASON_VALUES);

/** The unit a gateway expects on the wire. Confirmed per merchant contract. */
export const PAYMENT_AMOUNT_UNIT_VALUES = ['IRR', 'IRT'] as const;
export const PaymentAmountUnit = enumFrom(PAYMENT_AMOUNT_UNIT_VALUES);
export type PaymentAmountUnit = (typeof PAYMENT_AMOUNT_UNIT_VALUES)[number];
export const paymentAmountUnitSchema = z.enum(PAYMENT_AMOUNT_UNIT_VALUES);

/* ============================================================================
 * Quote
 * ==========================================================================*/

export const QUOTE_STATUS_VALUES = ['ACTIVE', 'EXPIRED', 'ACCEPTED', 'CANCELLED'] as const;

export const QuoteStatus = enumFrom(QUOTE_STATUS_VALUES);
export type QuoteStatus = (typeof QUOTE_STATUS_VALUES)[number];
export const quoteStatusSchema = z.enum(QUOTE_STATUS_VALUES);
