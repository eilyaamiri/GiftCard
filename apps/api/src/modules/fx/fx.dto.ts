import { z } from 'zod';
import { fxPairSchema, fxRateStringSchema } from '@barat/contracts';

/**
 * Request schemas for the FX endpoints.
 *
 * `packages/contracts` is frozen and currently ships the FX *response* shapes
 * only (`fxRateSnapshotSchema`, `getFxRateResponseSchema`). These request
 * schemas are declared here so the endpoints still validate every input; they
 * should move into `packages/contracts/src/dto/fx.ts` in the next Foundation
 * pass. Response payloads continue to use the frozen contract types.
 */

export const fxCurrentQuerySchema = z.object({
  pair: fxPairSchema.default('USD_IRR'),
});
export type FxCurrentQuery = z.infer<typeof fxCurrentQuerySchema>;

export const fxHistoryQuerySchema = z.object({
  pair: fxPairSchema.default('USD_IRR'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type FxHistoryQuery = z.infer<typeof fxHistoryQuerySchema>;

/**
 * A manual override is a human decision about money: it always requires a
 * reason and an explicit lifetime, and it may never outlive one day.
 */
export const fxOverrideRequestSchema = z
  .object({
    pair: fxPairSchema.default('USD_IRR'),
    buyRate: fxRateStringSchema,
    sellRate: fxRateStringSchema,
    midRate: fxRateStringSchema,
    reason: z.string().trim().min(3).max(500),
    ttlSeconds: z.number().int().min(60).max(86_400),
  })
  .strict();
export type FxOverrideRequest = z.infer<typeof fxOverrideRequestSchema>;

export const fxOverrideDeleteQuerySchema = z.object({
  pair: fxPairSchema.default('USD_IRR'),
});
export type FxOverrideDeleteQuery = z.infer<typeof fxOverrideDeleteQuerySchema>;
