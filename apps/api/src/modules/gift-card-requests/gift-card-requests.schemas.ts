import { z } from 'zod';

export const giftCardRequestKindSchema = z.enum(['CODE', 'CODE_PIN']);
export type GiftCardRequestKind = z.infer<typeof giftCardRequestKindSchema>;

export const giftCardRequestStatusSchema = z.enum(['OPEN', 'FULFILLED', 'CANCELLED']);
export type GiftCardRequestStatus = z.infer<typeof giftCardRequestStatusSchema>;

export const listGiftCardRequestsQuerySchema = z.object({
  status: giftCardRequestStatusSchema.optional(),
});
export type ListGiftCardRequestsQuery = z.infer<typeof listGiftCardRequestsQuerySchema>;

export const createGiftCardRequestSchema = z.object({
  workItemId: z.string().trim().min(1).max(100),
  kind: giftCardRequestKindSchema,
  reason: z.string().trim().min(3).max(500),
});
export type CreateGiftCardRequest = z.infer<typeof createGiftCardRequestSchema>;

export const fulfillGiftCardRequestSchema = z.object({
  code: z.string().trim().min(4).max(500),
  pin: z.string().trim().min(3).max(100).optional(),
});
export type FulfillGiftCardRequest = z.infer<typeof fulfillGiftCardRequestSchema>;
