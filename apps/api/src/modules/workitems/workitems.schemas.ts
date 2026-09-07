import { z } from 'zod';
import { queueKeySchema, workItemStatusSchema } from '@barat/contracts';

/**
 * Request schemas for the operator endpoints.
 *
 * These live here rather than in `packages/contracts` because that package is
 * frozen; when the Foundation agent next opens it, they should move verbatim.
 */

export const listWorkItemsQuerySchema = z.object({
  queueKey: queueKeySchema.optional(),
  status: workItemStatusSchema.optional(),
  assignedToStaffId: z.string().min(1).max(64).optional(),
  /**
   * Narrows to the work item(s) opened for one order. The back-office order page
   * uses it to reach the fulfilment workspace: without a server-side filter the
   * only way there is to page the whole queue and match client-side, which
   * silently stops working once the queue is longer than one page.
   */
  orderId: z.string().min(1).max(64).optional(),
  take: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListWorkItemsQuery = z.infer<typeof listWorkItemsQuerySchema>;

export const completeWorkItemBodySchema = z.object({
  resolutionNote: z.string().min(1).max(1_000).optional(),
});
export type CompleteWorkItemBody = z.infer<typeof completeWorkItemBodySchema>;

export const failWorkItemBodySchema = z.object({
  resolutionNote: z.string().min(1).max(1_000),
});
export type FailWorkItemBody = z.infer<typeof failWorkItemBodySchema>;
