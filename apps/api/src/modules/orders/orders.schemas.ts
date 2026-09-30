import { z } from 'zod';

import {
  createOrderRequestSchema,
  deliveryAssetTypeSchema,
  orderStatusSchema,
} from '@barat/contracts';

/**
 * Query schemas for the order endpoints.
 *
 * The customer-facing request/response shapes live in `@barat/contracts`
 * (frozen). What is added here is only the query-string coercion Express needs
 * — every value arrives as a string — and the admin filter set, which has no
 * contract counterpart yet. Both are built from contract primitives so the
 * status vocabulary can never drift.
 */

const pageSchema = z.coerce.number().int().min(1).default(1);
const pageSizeSchema = z.coerce.number().int().min(1).max(100).default(20);

/** POST /api/orders — the idempotency key is authoritative in the header. */
export const createOrderBodySchema = createOrderRequestSchema.extend({
  idempotencyKey: createOrderRequestSchema.shape.idempotencyKey.optional(),
});
export type CreateOrderBody = z.infer<typeof createOrderBodySchema>;

/** GET /api/orders — the customer's own orders. */
export const listOrdersQuerySchema = z.object({
  status: orderStatusSchema.optional(),
  page: pageSchema,
  pageSize: pageSizeSchema,
});
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;

/** GET /api/admin/orders — staff view, filterable across all customers. */
export const adminListOrdersQuerySchema = z
  .object({
    status: orderStatusSchema.optional(),
    customerId: z.string().min(1).max(64).optional(),
    orderNumber: z.string().min(1).max(64).optional(),
    quoteId: z.string().min(1).max(64).optional(),
    /** Inclusive lower bound on `createdAt`. */
    from: z.iso.datetime({ offset: true }).optional(),
    /** Exclusive upper bound on `createdAt`. */
    to: z.iso.datetime({ offset: true }).optional(),
    search: z.string().max(120).optional(),
    page: pageSchema,
    pageSize: pageSizeSchema,
  })
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    path: ['to'],
    message: '`to` must not be earlier than `from`',
  });
export type AdminListOrdersQuery = z.infer<typeof adminListOrdersQuerySchema>;

/** Path parameter for GET /api/orders/:orderNumber. */
export const orderNumberParamSchema = z.object({
  orderNumber: z.string().min(1).max(64),
});

/** Path parameter for the admin detail endpoint. */
export const orderIdParamSchema = z.object({
  id: z.string().min(1).max(64),
});

/**
 * POST /api/orders/:orderNumber/delivery/reveal — the plaintext card.
 *
 * GAP: this belongs in `@barat/contracts` next to `orderDeliveryDtoSchema`,
 * which is frozen and has no field able to carry a code. It is declared here so
 * the response still has one authoritative shape; move it into the contracts
 * package when that file is unfrozen.
 *
 * Declared as a schema and not merely a type because it is the *only* response
 * in the API that carries a secret, and an explicit allow-list is what stops a
 * future refactor widening it: nothing that is not listed here can be returned.
 */
export const revealDeliveryResponseSchema = z.object({
  /*
   * Taken from the frozen contracts enum rather than repeated as a literal.
   * The local copy fell behind the moment `DIRECT_TOPUP` was added — a gift
   * card and a top-up are both deliverable, and a reveal endpoint that does not
   * know a delivery type exists will reject a legitimate order. Sharing the
   * source of truth means the next added type cannot diverge.
   */
  assetType: deliveryAssetTypeSchema,
  /**
   * Absent for URL, provider-direct and direct-top-up deliveries: there is no
   * code to show. A top-up credits the customer's game account, so the reveal
   * response carries no secret at all.
   */
  code: z.string().nullable(),
  pin: z.string().nullable(),
  deliveryUrl: z.url().nullable(),
  expiryDate: z.iso.datetime({ offset: true }).nullable(),
});
export type RevealDeliveryResponse = z.infer<typeof revealDeliveryResponseSchema>;
