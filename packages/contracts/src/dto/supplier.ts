import { z } from 'zod';

import { idSchema } from './common';

/* ============================================================================
 * Operator supplier purchase  — POST /api/operator/suppliers/purchase
 *
 * The body names WHAT to buy and nothing about how much or for whom: the
 * customer, the quantity and the supplier idempotency key are all read from
 * the order on the server (FUL-2, Z-FUL-3). A client-chosen key could slip past
 * the supplier's duplicate protection; a client-chosen quantity could buy more
 * than was paid for.
 * ==========================================================================*/

export const operatorSupplierPurchaseRequestSchema = z.object({
  orderId: idSchema,
  workItemId: idSchema,
  offerId: idSchema,
  /** Buy again after the previous attempt definitively FAILED. */
  retry: z.boolean().optional(),
  recipientEmail: z.email().max(320).optional(),
});
export type OperatorSupplierPurchaseRequest = z.infer<typeof operatorSupplierPurchaseRequestSchema>;

/**
 * A manager settles an unsettled purchase (in flight after a crash, pending,
 * or of unknown outcome) after checking with the supplier. FAILED allows an
 * explicit retry; SUCCEEDED records that the card was obtained.
 */
export const closeSupplierPurchaseAttemptRequestSchema = z.object({
  orderId: idSchema,
  outcome: z.enum(['FAILED', 'SUCCEEDED']),
  reason: z.string().trim().min(10).max(500),
});
export type CloseSupplierPurchaseAttemptRequest = z.infer<typeof closeSupplierPurchaseAttemptRequestSchema>;
