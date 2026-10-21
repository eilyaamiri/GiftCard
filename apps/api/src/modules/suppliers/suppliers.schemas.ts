import { z } from 'zod';

/**
 * Supplier operator request schemas that are not part of the shared contract.
 * The purchase request itself lives in `@barat/contracts` (Z-FUL-3).
 */

export const listOffersQuerySchema = z.object({
  skuId: z.string().trim().min(1).max(64),
});
export type ListOffersQuery = z.infer<typeof listOffersQuerySchema>;

export const checkPurchaseStatusBodySchema = z.object({
  providerCode: z.string().trim().min(1).max(64),
  providerReference: z.string().trim().min(1).max(256),
});
export type CheckPurchaseStatusBody = z.infer<typeof checkPurchaseStatusBodySchema>;

/**
 * A top-up catalogue import. `dryRun` has no default on purpose: the caller
 * states whether this run writes, rather than a missing field deciding it.
 */
export const importTopUpCatalogBodySchema = z.object({
  supplierCode: z.string().trim().min(1).max(64).default('fazercards-topup'),
  dryRun: z.boolean(),
});
export type ImportTopUpCatalogBody = z.infer<typeof importTopUpCatalogBodySchema>;
