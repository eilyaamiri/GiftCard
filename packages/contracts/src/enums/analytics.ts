import { z } from 'zod';

import { enumFrom } from '../internal/enum-utils';

/* ============================================================================
 * Funnel
 * ==========================================================================*/

/**
 * The conversion funnel, in order. Dashboard step counts are derived from these
 * events only — never from ad-hoc queries — so the numbers are reproducible.
 */
export const FUNNEL_EVENT_TYPE_VALUES = [
  'PRODUCT_VIEWED',
  'SERVICE_VIEWED',
  'CART_CREATED',
  'CART_ITEM_ADDED',
  'CART_ITEM_REMOVED',
  'QUOTE_GENERATED',
  'QUOTE_ACCEPTED',
  'CHECKOUT_STARTED',
  'CUSTOMER_IDENTIFIED',
  'PAYMENT_STARTED',
  'PAYMENT_REDIRECTED',
  'PAYMENT_RETURNED',
  'PAYMENT_VERIFIED',
  'PAYMENT_FAILED',
  'PAYMENT_CANCELLED',
  'ORDER_FULFILLED',
] as const;

export const FunnelEventType = enumFrom(FUNNEL_EVENT_TYPE_VALUES);
export type FunnelEventType = (typeof FUNNEL_EVENT_TYPE_VALUES)[number];
export const funnelEventTypeSchema = z.enum(FUNNEL_EVENT_TYPE_VALUES);

/* ============================================================================
 * Abandonment
 * ==========================================================================*/

export const ABANDONMENT_TYPE_VALUES = [
  'BROWSE_ABANDONMENT',
  'QUOTE_ABANDONMENT',
  'CHECKOUT_ABANDONMENT',
  'PAYMENT_ABANDONMENT',
  'EXPIRED_QUOTE',
] as const;

export const AbandonmentType = enumFrom(ABANDONMENT_TYPE_VALUES);
export type AbandonmentType = (typeof ABANDONMENT_TYPE_VALUES)[number];
export const abandonmentTypeSchema = z.enum(ABANDONMENT_TYPE_VALUES);

/* ============================================================================
 * Feature flags
 * ==========================================================================*/

/**
 * Flag keys are a closed set: a typo must be a compile error, not a silently
 * disabled feature. Flipping `zarinpal_enabled` or `payment_gateway_enabled` in
 * production is a human gate (AGENTS.md section 4).
 */
export const FEATURE_FLAG_KEY_VALUES = [
  'gift_cards_enabled',
  'international_payments_enabled',
  'manual_fulfillment_enabled',
  'supplier_api_enabled',
  'fx_auto_rate_enabled',
  'payment_gateway_enabled',
  'zarinpal_enabled',
] as const;

export const FeatureFlagKey = enumFrom(FEATURE_FLAG_KEY_VALUES);
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEY_VALUES)[number];
export const featureFlagKeySchema = z.enum(FEATURE_FLAG_KEY_VALUES);
