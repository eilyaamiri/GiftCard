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
