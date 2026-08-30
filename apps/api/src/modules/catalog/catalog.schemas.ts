import Decimal from 'decimal.js';
import { z } from 'zod';

import { deliveryAssetTypeSchema } from '@barat/contracts';

const idSchema = z.string().min(1).max(64);
const currencySchema = z.string().regex(/^[A-Z]{3}$/u);
const decimalSchema = z.string().regex(/^\d+(?:\.\d{1,6})?$/u);
const nonNegativeDecimalSchema = z.string().regex(/^\d+(?:\.\d{1,6})?$/u);

/* ============================================================================
 * Create vs. patch
 *
 * A create schema supplies defaults: `isActive` is true, `availability` is
 * AVAILABLE, `discountBps` is 0. A PATCH must NOT.
 *
 * `.partial()` makes a field optional but leaves a `.default()` in place, so
 * `updateSupplierOffer({ costAmount })` would parse to a payload that ALSO
 * carries `discountBps: 0` and `availability: 'AVAILABLE'`. Handed to
 * `prisma.update`, that silently resets columns the admin never touched — and
 * on a supplier offer those two columns feed the supplier-cost side of every
 * quote. It would also defeat the "at least one field" guard, because a
 * defaulted key is always present.
 *
 * So a patch schema is built from the same shape with the default wrappers
 * removed: an absent key stays absent and Prisma leaves the column alone.
 * ==========================================================================*/

type Undefaulted<T extends z.ZodRawShape> = {
  [K in keyof T]: T[K] extends z.ZodDefault<infer Inner> ? Inner : T[K];
};

function stripDefaults<T extends z.ZodRawShape>(shape: T): Undefaulted<T> {
  const stripped: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape as unknown as Record<string, z.ZodType>)) {
    stripped[key] = schema.def.type === 'default' ? (schema as z.ZodDefault).unwrap() : schema;
  }
  return stripped as unknown as Undefaulted<T>;
}

/** Every field optional, no defaults applied, and an empty body refused. */
function patchSchema<T extends z.ZodRawShape>(shape: T) {
  return z
    .object(stripDefaults(shape))
    .partial()
    .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
}

export const adminCatalogListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
});

export const adminSkuListSchema = adminCatalogListSchema.extend({
  productId: idSchema.optional(),
});

export const adminSupplierOfferListSchema = adminCatalogListSchema.extend({
  supplierId: idSchema.optional(),
  skuId: idSchema.optional(),
});

export const adminServiceFieldListSchema = z.object({
  serviceId: idSchema,
});

export type AdminCatalogListInput = z.infer<typeof adminCatalogListSchema>;
export type AdminSkuListInput = z.infer<typeof adminSkuListSchema>;
export type AdminSupplierOfferListInput = z.infer<typeof adminSupplierOfferListSchema>;
export type AdminServiceFieldListInput = z.infer<typeof adminServiceFieldListSchema>;

/* -------------------------------------------------------------- product */

const productShape = {
  slug: z.string().trim().min(1).max(120),
  brand: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  titleFa: z.string().trim().min(1).max(240),
  description: z.string().max(4_000).nullable().optional(),
  descriptionFa: z.string().max(4_000).nullable().optional(),
  category: z.string().trim().min(1).max(120),
  imageUrl: z.url().max(2_000).nullable().optional(),
  redemptionNotesFa: z.string().max(4_000).nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
};

export const createProductSchema = z.object(productShape);
export const updateProductSchema = patchSchema(productShape);

/* ------------------------------------------------------------------ sku */

/**
 * `productId` is create-only: moving a SKU to another product would silently
 * re-parent every quote and order that already referenced it.
 */
const skuMutableShape = {
  code: z.string().trim().min(1).max(120),
  region: z.string().trim().min(2).max(8),
  currency: currencySchema.default('USD'),
  faceValue: decimalSchema,
  denominationLabel: z.string().trim().min(1).max(120),
  deliveryAssetType: deliveryAssetTypeSchema.default('CODE'),
  isActive: z.boolean().default(true),
  minQuantity: z.number().int().min(1).default(1),
  maxQuantity: z.number().int().min(1).max(100).default(10),
};

export const createSkuSchema = z
  .object({ productId: idSchema, ...skuMutableShape })
  .refine((value) => value.maxQuantity >= value.minQuantity, {
    path: ['maxQuantity'],
    message: 'maxQuantity must be greater than or equal to minQuantity',
  });

/**
 * A patch may send one bound without the other, so the pair can only be checked
 * against the stored row — `CatalogService.adminUpdateSku` does exactly that.
 * The check here catches the case where both arrive together.
 */
export const updateSkuSchema = patchSchema(skuMutableShape).refine(
  (value) =>
    value.minQuantity === undefined ||
    value.maxQuantity === undefined ||
    value.maxQuantity >= value.minQuantity,
  { path: ['maxQuantity'], message: 'maxQuantity must be greater than or equal to minQuantity' },
);

/* ------------------------------------------------------------- supplier */

const supplierShape = {
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  integrationMode: z.enum(['MANUAL', 'API']).default('MANUAL'),
  supportsRawCode: z.boolean().default(false),
  defaultCurrency: currencySchema.default('USD'),
  isActive: z.boolean().default(true),
  notes: z.string().max(4_000).nullable().optional(),
};

export const createSupplierSchema = z.object(supplierShape);
export const updateSupplierSchema = patchSchema(supplierShape);

/* ------------------------------------------------------- supplier offer */

/** `supplierId` / `skuId` identify the offer; changing either is a new offer. */
const supplierOfferMutableShape = {
  costCurrency: currencySchema.default('USD'),
  costAmount: decimalSchema,
  discountBps: z.number().int().min(0).max(10_000).default(0),
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE']).default('AVAILABLE'),
  priority: z.number().int().min(0).default(100),
  isActive: z.boolean().default(true),
};

export const createSupplierOfferSchema = z.object({
  supplierId: idSchema,
  skuId: idSchema,
  ...supplierOfferMutableShape,
});
export const updateSupplierOfferSchema = patchSchema(supplierOfferMutableShape);

/* ------------------------------------------------- international service */

export const serviceFieldInputSchema = z.object({
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  labelFa: z.string().trim().min(1).max(240),
  fieldType: z
    .enum(['TEXT', 'EMAIL', 'URL', 'NUMBER', 'SELECT', 'TEXTAREA', 'FILE'])
    .default('TEXT'),
  isRequired: z.boolean().default(true),
  validationRegex: z.string().max(500).nullable().optional(),
  helpTextFa: z.string().max(1_000).nullable().optional(),
  options: z
    .array(z.object({ value: z.string(), labelFa: z.string() }))
    .nullable()
    .optional(),
  sortOrder: z.number().int().min(0).default(0),
});

/** `fields` is create-only: field definitions are managed one by one. */
const internationalServiceMutableShape = {
  slug: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  nameFa: z.string().trim().min(1).max(240),
  category: z.string().trim().min(1).max(120),
  currency: currencySchema.default('USD'),
  minAmount: nonNegativeDecimalSchema.nullable().optional(),
  maxAmount: nonNegativeDecimalSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  requiresManualReview: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
};

/** Exact decimal comparison — the bounds are money, never JS floats (rule 2). */
function boundsAreOrdered(value: {
  minAmount?: string | null | undefined;
  maxAmount?: string | null | undefined;
}): boolean {
  return (
    value.minAmount == null ||
    value.maxAmount == null ||
    new Decimal(value.minAmount).lte(new Decimal(value.maxAmount))
  );
}

const BOUNDS_ISSUE = {
  path: ['maxAmount'],
  message: 'maxAmount must be greater than or equal to minAmount',
};

export const createInternationalServiceSchema = z
  .object({
    ...internationalServiceMutableShape,
    fields: z.array(serviceFieldInputSchema).default([]),
  })
  .refine(boundsAreOrdered, BOUNDS_ISSUE);

export const updateInternationalServiceSchema = patchSchema(
  internationalServiceMutableShape,
).refine(boundsAreOrdered, BOUNDS_ISSUE);

/* --------------------------------------------------------- service field */

export const createServiceFieldSchema = serviceFieldInputSchema.extend({ serviceId: idSchema });
export const updateServiceFieldSchema = patchSchema(serviceFieldInputSchema.shape);

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type CreateSkuInput = z.infer<typeof createSkuSchema>;
export type UpdateSkuInput = z.infer<typeof updateSkuSchema>;
export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type CreateSupplierOfferInput = z.infer<typeof createSupplierOfferSchema>;
export type UpdateSupplierOfferInput = z.infer<typeof updateSupplierOfferSchema>;
export type CreateInternationalServiceInput = z.infer<typeof createInternationalServiceSchema>;
export type UpdateInternationalServiceInput = z.infer<typeof updateInternationalServiceSchema>;
export type CreateServiceFieldInput = z.infer<typeof createServiceFieldSchema>;
export type UpdateServiceFieldInput = z.infer<typeof updateServiceFieldSchema>;
