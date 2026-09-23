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

/**
 * The product list is the one admin list that has to work against the whole
 * imported catalog — thousands of rows — so it takes a free-text term as well.
 * The other lists stay on the plain paging schema: adding `search` to the
 * shared one would advertise a filter that suppliers and services silently
 * ignore.
 */
export const adminProductStatusSchema = z.enum(['ALL', 'ACTIVE', 'INACTIVE']);
export type AdminProductStatus = z.infer<typeof adminProductStatusSchema>;

export const adminProductListSchema = adminCatalogListSchema.extend({
  search: z.string().max(120).optional(),
  status: adminProductStatusSchema.default('ALL'),
  categoryId: idSchema.optional(),
  brandId: idSchema.optional(),
  /**
   * The "what still needs an operator" view. There is no separate
   * uncategorised list because no product is left without a category — the ones
   * the rules could not place are in «سایر» with this flag set, which is the
   * same queue by a more honest name.
   */
  needsReview: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

/** ~330 brands, and finding a duplicate means searching for it by name. */
export const adminBrandListSchema = adminCatalogListSchema.extend({
  search: z.string().max(120).optional(),
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
export type AdminBrandListInput = z.infer<typeof adminBrandListSchema>;
export type AdminProductListInput = Omit<z.infer<typeof adminProductListSchema>, 'status'> & {
  status?: AdminProductStatus;
};
export type AdminSkuListInput = z.infer<typeof adminSkuListSchema>;
export type AdminSupplierOfferListInput = z.infer<typeof adminSupplierOfferListSchema>;
export type AdminServiceFieldListInput = z.infer<typeof adminServiceFieldListSchema>;

/* ------------------------------------------------------------- taxonomy */

/**
 * The icons a category may name.
 *
 * An allow-list rather than a free text field, and deliberately the same set
 * the web app draws: the storefront's icons come from one family, and an
 * operator pasting an icon name (or worse, a URL to some other icon set) would
 * put a foreign style next to the project's own. Kept in sync with
 * `CATEGORY_ICON_KEYS` in apps/web/src/lib/catalog.ts.
 */
export const CATEGORY_ICON_KEYS = [
  'sparkles',
  'gamepad-2',
  'joystick',
  'clapperboard',
  'shopping-bag',
  'smartphone',
  'app-window',
  'book-open',
  'utensils',
  'plane',
  'dumbbell',
  'cpu',
  'sofa',
  'flower-2',
  'credit-card',
  'wallet',
  'ellipsis',
  'gift',
] as const;

export const categoryIconKeySchema = z.enum(CATEGORY_ICON_KEYS);

/** Lowercase, hyphen-separated. It ends up in a storefront URL. */
const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(90)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'نشانه باید با حروف کوچک انگلیسی و خط تیره باشد.');

const categoryShape = {
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  nameFa: z.string().trim().min(1).max(120),
  iconKey: categoryIconKeySchema.default('gift'),
  descriptionFa: z.string().max(1_000).nullable().optional(),
  parentId: idSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().default(0),
};

export const createCategorySchema = z.object(categoryShape);
export const updateCategorySchema = patchSchema(categoryShape);

const brandShape = {
  slug: slugSchema,
  name: z.string().trim().min(1).max(120),
  nameFa: z.string().trim().min(1).max(120),
  logoUrl: z.string().trim().max(2_000).nullable().optional(),
  descriptionFa: z.string().max(1_000).nullable().optional(),
  isActive: z.boolean().default(true),
  /** Curated. Nothing here is computed from traffic, because there is none. */
  isPopular: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
};

export const createBrandSchema = z.object(brandShape);
export const updateBrandSchema = patchSchema(brandShape);

/** Move a batch of products into one category in a single pass. */
export const assignCategorySchema = z.object({
  productIds: z.array(idSchema).min(1).max(500),
  categoryId: idSchema,
});

/** Activate or deactivate a batch of products in a single pass. */
export const bulkSetProductActiveSchema = z.object({
  productIds: z.array(idSchema).min(1).max(500),
  isActive: z.boolean(),
});

/**
 * Fold one brand into another.
 *
 * The feeds ship the same brand under several spellings, and the import cannot
 * always tell. Merging moves the products across and then removes the emptied
 * brand — products are never deleted, which is the whole point of doing this
 * rather than deactivating the duplicate and losing its catalog.
 */
export const mergeBrandsSchema = z
  .object({ sourceBrandId: idSchema, targetBrandId: idSchema })
  .refine((value) => value.sourceBrandId !== value.targetBrandId, {
    path: ['sourceBrandId'],
    message: 'یک برند را نمی‌توان با خودش ادغام کرد.',
  });

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type CreateBrandInput = z.infer<typeof createBrandSchema>;
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>;
export type AssignCategoryInput = z.infer<typeof assignCategorySchema>;
export type BulkSetProductActiveInput = z.infer<typeof bulkSetProductActiveSchema>;
export type MergeBrandsInput = z.infer<typeof mergeBrandsSchema>;

/* -------------------------------------------------------------- product */

const productShape = {
  slug: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(240),
  titleFa: z.string().trim().min(1).max(240),
  description: z.string().max(4_000).nullable().optional(),
  descriptionFa: z.string().max(4_000).nullable().optional(),
  imageUrl: z.url().max(2_000).nullable().optional(),
  redemptionNotesFa: z.string().max(4_000).nullable().optional(),
  isActive: z.boolean().default(true),
  /** Data is incomplete: still listed, but not orderable. */
  needsReview: z.boolean().default(false),
  isQuickPick: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
};

/**
 * The supplier's free-text brand and category.
 *
 * Still writable, because a re-import matches on them, but no longer something
 * an operator has to fill in: left out, the service copies the names of the
 * brand and category that were actually chosen.
 */
const legacyTaxonomyShape = {
  brand: z.string().trim().min(1).max(120).optional(),
  category: z.string().trim().min(1).max(120).optional(),
};

/**
 * `brandId` and `categoryId` are required here and optional in the patch. A
 * product with neither cannot be found by anyone browsing the storefront, so
 * creating one is a mistake worth refusing at the door; the thousands already
 * imported are a different problem, and they have both.
 */
export const createProductSchema = z.object({
  ...productShape,
  ...legacyTaxonomyShape,
  brandId: idSchema,
  categoryId: idSchema,
  extraCategoryIds: z.array(idSchema).max(5).default([]),
});
export const updateProductSchema = patchSchema({
  ...productShape,
  ...legacyTaxonomyShape,
  brandId: idSchema,
  categoryId: idSchema,
  extraCategoryIds: z.array(idSchema).max(5),
});

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
  descriptionFa: z.string().max(4_000).nullable().optional(),
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
