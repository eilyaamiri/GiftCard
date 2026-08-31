import { z } from 'zod';

import { orderStatusSchema } from '../enums/commerce';
import { deliveryAssetTypeSchema, deliveryStatusSchema } from '../enums/operations';
import { positiveIrrStringSchema } from '../money/schemas';
import {
  commerceSessionTokenSchema,
  idSchema,
  idempotencyKeySchema,
  isoDateTimeSchema,
  paginationMetaSchema,
} from './common';

/* ============================================================================
 * Order DTOs
 * ==========================================================================*/

/**
 * What the customer may see about the delivered asset.
 *
 * There is deliberately no `code` field. The plaintext code is decrypted only at
 * the moment of delivery, and reads are audited. The panel shows `maskedCode`.
 */
export const orderDeliveryDtoSchema = z.object({
  assetType: deliveryAssetTypeSchema,
  status: deliveryStatusSchema,
  maskedCode: z.string().nullable(),
  /** Redemption link for `URL` assets. */
  deliveryUrl: z.string().nullable(),
  /** Masked recipient for `PROVIDER_DIRECT_EMAIL`, e.g. `a***@gmail.com`. */
  recipientEmailMasked: z.string().nullable(),
  expiryDate: isoDateTimeSchema.nullable(),
  sentAt: isoDateTimeSchema.nullable(),
});
export type OrderDeliveryDto = z.infer<typeof orderDeliveryDtoSchema>;

export const orderSummaryDtoSchema = z.object({
  id: idSchema,
  orderNumber: z.string().min(1),
  status: orderStatusSchema,
  totalAmountIrr: positiveIrrStringSchema,
  displayAmountToman: positiveIrrStringSchema,
  currency: z.string().regex(/^[A-Z]{3}$/u),
  itemTitleFa: z.string(),
  createdAt: isoDateTimeSchema,
  paidAt: isoDateTimeSchema.nullable(),
  fulfilledAt: isoDateTimeSchema.nullable(),
});
export type OrderSummaryDto = z.infer<typeof orderSummaryDtoSchema>;

export const orderDetailDtoSchema = orderSummaryDtoSchema.extend({
  quoteId: idSchema,
  cartId: idSchema.nullable(),
  customerId: idSchema,
  cancelledAt: isoDateTimeSchema.nullable(),
  /** Normalised, customer-safe reason. Never a raw provider message. */
  failureReason: z.string().nullable(),
  delivery: orderDeliveryDtoSchema.nullable(),
  /** Customer-visible timeline, derived from audited status transitions. */
  timeline: z.array(
    z.object({
      status: orderStatusSchema,
      at: isoDateTimeSchema,
      noteFa: z.string().nullable(),
    }),
  ),
});
export type OrderDetailDto = z.infer<typeof orderDetailDtoSchema>;

/* ============================================================================
 * POST /api/orders  — createOrder
 * ==========================================================================*/

/**
 * Creating an order is idempotent (rule 9). The quote must be `ACCEPTED` and not
 * expired; the order total is copied from the quote, never sent by the client.
 */
export const createOrderRequestSchema = z.object({
  quoteId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  /**
   * Echo of what the customer confirmed. A mismatch against the stored quote
   * raises `AMOUNT_MISMATCH` and halts the flow.
   */
  acknowledgedAmountIrr: positiveIrrStringSchema,
  /** Where a `PROVIDER_DIRECT_EMAIL` or `URL` asset should be delivered. */
  deliveryEmail: z.email().optional(),
  commerceSessionToken: commerceSessionTokenSchema.optional(),
  customerNote: z.string().max(500).optional(),
});
export type CreateOrderRequest = z.infer<typeof createOrderRequestSchema>;

export const createOrderResponseSchema = z.object({
  order: orderDetailDtoSchema,
  /** False when an existing order was returned for a replayed idempotency key. */
  created: z.boolean(),
});
export type CreateOrderResponse = z.infer<typeof createOrderResponseSchema>;

/* ============================================================================
 * GET /api/orders
 * ==========================================================================*/

export const listOrdersRequestSchema = z.object({
  status: orderStatusSchema.optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type ListOrdersRequest = z.infer<typeof listOrdersRequestSchema>;

export const listOrdersResponseSchema = z.object({
  items: z.array(orderSummaryDtoSchema),
  meta: paginationMetaSchema,
});
export type ListOrdersResponse = z.infer<typeof listOrdersResponseSchema>;

export const getOrderResponseSchema = z.object({
  order: orderDetailDtoSchema,
});
export type GetOrderResponse = z.infer<typeof getOrderResponseSchema>;
