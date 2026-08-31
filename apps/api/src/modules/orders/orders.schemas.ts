import { z } from 'zod';

import { createOrderRequestSchema, orderStatusSchema } from '@barat/contracts';

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
