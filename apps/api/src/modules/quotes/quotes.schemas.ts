import { z } from 'zod';

import { idempotencyKeySchema, positiveIrrStringSchema } from '@barat/contracts';

/** `GET /api/quotes/:id` and `POST /api/quotes/:id/accept`. */
export const quoteIdParamSchema = z.object({ id: z.string().min(1).max(64) });
export type QuoteIdParam = z.infer<typeof quoteIdParamSchema>;

/**
 * The accept body without `quoteId`: the id belongs to the route, so accepting
 * a body copy of it would create two sources of truth for which quote is being
 * accepted. The controller reattaches the path id before calling the service.
 */
export const acceptQuoteBodySchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  acknowledgedAmountIrr: positiveIrrStringSchema,
  commerceSessionToken: z.string().min(16).max(128).optional(),
});
export type AcceptQuoteBody = z.infer<typeof acceptQuoteBodySchema>;
