import { z } from 'zod';

/**
 * Request schemas for the operator fulfillment endpoints.
 *
 * They live here rather than in `packages/contracts` because that package is
 * frozen for this phase; when Foundation next opens it they should move verbatim.
 *
 * Note the shape of `assetSchema`: it is a discriminated union, so `code` is not
 * merely optional for a `URL` or `PROVIDER_DIRECT_EMAIL` asset — it is rejected.
 * That is the validation-layer half of "the code field is disabled for non-code
 * asset types"; the UI half is a convenience, this is the enforcement.
 */

/** Fixed-point decimal string. Money never arrives as a JSON number. */
const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,6})?$/u, 'مبلغ باید عدد اعشاری معتبر باشد.');

const currencyCode = z.string().trim().toUpperCase().length(3);

const isoDate = z.coerce.date();

export const assetSchema = z.discriminatedUnion('assetType', [
  z.object({
    assetType: z.literal('CODE'),
    code: z.string().trim().min(4).max(256),
    serialNumber: z.string().trim().min(1).max(128).optional(),
    expiryDate: isoDate.optional(),
  }),
  z.object({
    assetType: z.literal('CODE_PIN'),
    code: z.string().trim().min(4).max(256),
    pin: z.string().trim().min(3).max(64),
    serialNumber: z.string().trim().min(1).max(128).optional(),
    expiryDate: isoDate.optional(),
  }),
  z.object({
    assetType: z.literal('URL'),
    deliveryUrl: z.url().max(2_048),
    expiryDate: isoDate.optional(),
  }),
  z.object({
    assetType: z.literal('PROVIDER_DIRECT_EMAIL'),
    recipientEmail: z.email().max(320),
  }),
]);

export const recordSupplierResultBodySchema = z.object({
  skuId: z.string().min(1).max(64).optional(),
  supplierId: z.string().min(1).max(64).optional(),
  supplierReference: z.string().trim().min(1).max(256).optional(),
  actualSupplierCost: decimalString.optional(),
  actualSupplierCurrency: currencyCode.optional(),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
  asset: assetSchema,
});
export type RecordSupplierResultBody = z.infer<typeof recordSupplierResultBodySchema>;

export const checkChecklistItemBodySchema = z.object({
  itemKey: z.string().trim().min(1).max(64),
  checked: z.boolean(),
  note: z.string().trim().min(1).max(1_000).optional(),
});
export type CheckChecklistItemBody = z.infer<typeof checkChecklistItemBodySchema>;

export const setChecklistFieldBodySchema = z.object({
  itemKey: z.string().trim().min(1).max(64),
  value: z.string().trim().min(1).max(1_000),
});
export type SetChecklistFieldBody = z.infer<typeof setChecklistFieldBodySchema>;

/** A reason is mandatory for every privileged action, so the trail is readable. */
export const reasonBodySchema = z.object({
  reason: z.string().trim().min(3).max(1_000),
});
export type ReasonBody = z.infer<typeof reasonBodySchema>;

/**
 * Body of the worker's retry call. Just an id — the worker never handles, and
 * therefore never has to be trusted with, the asset's contents.
 */
export const internalRetryDeliveryBodySchema = z.object({
  assetId: z.string().trim().min(1).max(64),
});
export type InternalRetryDeliveryBody = z.infer<typeof internalRetryDeliveryBodySchema>;
