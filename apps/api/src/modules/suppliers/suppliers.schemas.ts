import { z } from 'zod';

/**
 * Supplier operator request schemas. Kept local while `packages/contracts` is
 * frozen; move them to the shared DTO package when Foundation opens it again.
 */

export const listOffersQuerySchema = z.object({
  skuId: z.string().trim().min(1).max(64),
});
export type ListOffersQuery = z.infer<typeof listOffersQuerySchema>;

export const purchaseBodySchema = z.object({
  orderId: z.string().trim().min(1).max(64),
  customerId: z.string().trim().min(1).max(64).optional(),
  workItemId: z.string().trim().min(1).max(64),
  offerId: z.string().trim().min(1).max(64),
  quantity: z.number().int().min(1).max(10),
  idempotencyKey: z.string().trim().min(8).max(128),
  recipientEmail: z.email().max(320).optional(),
});
export type PurchaseBody = z.infer<typeof purchaseBodySchema>;

export const checkPurchaseStatusBodySchema = z.object({
  providerCode: z.string().trim().min(1).max(64),
  providerReference: z.string().trim().min(1).max(256),
});
export type CheckPurchaseStatusBody = z.infer<typeof checkPurchaseStatusBodySchema>;
