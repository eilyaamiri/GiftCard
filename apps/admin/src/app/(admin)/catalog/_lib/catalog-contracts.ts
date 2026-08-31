import { z } from "zod";
import { deliveryAssetTypeSchema, idSchema, isoDateTimeSchema, paginatedSchema } from "@barat/contracts";

/**
 * Wire shapes for `/api/admin/catalog/*`.
 *
 * @barat/contracts only ships the customer-facing catalog DTOs (no supplier
 * cost, no admin pagination envelope), so every shape here is pinned directly
 * to `CatalogAdminController` / `CatalogService` in apps/api. Only the pieces
 * that are genuinely shared (delivery asset type, id/date primitives, the
 * pagination envelope) are imported instead of restated.
 */

const currencySchema = z.string().regex(/^[A-Z]{3}$/u);
/** Matches the API's decimal string validators (up to 6 fractional digits). */
const decimalStringSchema = z.string().regex(/^\d+(?:\.\d{1,6})?$/u);

/* ============================================================================
 * Product
 * ==========================================================================*/

export const adminProductSchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  brand: z.string().min(1),
  title: z.string().min(1),
  titleFa: z.string().min(1),
  description: z.string().nullable(),
  descriptionFa: z.string().nullable(),
  category: z.string().min(1),
  imageUrl: z.string().nullable(),
  redemptionNotesFa: z.string().nullable().optional(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  _count: z.object({ skus: z.number().int() }).optional(),
});
export type AdminProduct = z.infer<typeof adminProductSchema>;

export const adminProductListSchema = paginatedSchema(adminProductSchema);

export const adminProductDetailSchema = adminProductSchema.extend({
  skus: z.array(z.lazy(() => adminSkuSchema)),
});
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;

const productMutableFields = {
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
  sortOrder: z.coerce.number().int().default(0),
};
export const createProductRequestSchema = z.object(productMutableFields);
export type CreateProductRequest = z.infer<typeof createProductRequestSchema>;
export const updateProductRequestSchema = z.object(productMutableFields).partial();
export type UpdateProductRequest = z.infer<typeof updateProductRequestSchema>;

/* ============================================================================
 * SKU
 *
 * A SKU and a supplier offer nest into each other one level deep in the live
 * API (a product's SKU carries its offers with `supplier` but no further
 * `sku`; an offer carries its `sku` with `product` but no `supplierOffers`),
 * never both directions at once. Encoding that literally — rather than having
 * `adminSkuSchema` and `adminOfferSchema` reference each other — keeps every
 * type here inferable; a true mutual `z.lazy()` pair makes both constants
 * implicitly `any` (TS7022/TS7024).
 * ==========================================================================*/

const skuBaseFields = {
  id: idSchema,
  productId: idSchema,
  code: z.string().min(1),
  region: z.string().min(2).max(8),
  currency: currencySchema,
  faceValue: decimalStringSchema,
  denominationLabel: z.string().min(1),
  deliveryAssetType: deliveryAssetTypeSchema,
  isActive: z.boolean(),
  minQuantity: z.number().int().min(1),
  maxQuantity: z.number().int().min(1),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

/** The `sku` nested inside an offer — one level, no `supplierOffers` back-reference. */
const offerSkuSchema = z.object({
  ...skuBaseFields,
  product: adminProductSchema.optional(),
});

export const adminSupplierSchema = z.object({
  id: idSchema,
  code: z.string().min(1),
  name: z.string().min(1),
  integrationMode: z.enum(["MANUAL", "API"]),
  supportsRawCode: z.boolean(),
  defaultCurrency: currencySchema,
  isActive: z.boolean(),
  notes: z.string().nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  _count: z.object({ offers: z.number().int() }).optional(),
});
export type AdminSupplier = z.infer<typeof adminSupplierSchema>;

const offerBaseFields = {
  id: idSchema,
  supplierId: idSchema,
  skuId: idSchema,
  costCurrency: currencySchema,
  costAmount: decimalStringSchema,
  discountBps: z.number().int().min(0).max(10_000),
  availability: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  priority: z.number().int().min(0),
  isActive: z.boolean(),
  lastCheckedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
};

/** The `supplierOffers` nested inside a SKU — carries `supplier`, no `sku` back-reference. */
const skuOfferSchema = z.object({
  ...offerBaseFields,
  supplier: adminSupplierSchema.optional(),
});

export const adminSkuSchema = z.object({
  ...skuBaseFields,
  product: adminProductSchema.optional(),
  _count: z.object({ supplierOffers: z.number().int() }).optional(),
  /** Present on `adminGetProduct`'s nested SKUs, which carry the full offer list instead of a count. */
  supplierOffers: z.array(skuOfferSchema).optional(),
});
export type AdminSku = z.infer<typeof adminSkuSchema>;

export function skuOfferCount(sku: AdminSku): number {
  return sku._count?.supplierOffers ?? sku.supplierOffers?.length ?? 0;
}

export const adminSkuListSchema = paginatedSchema(adminSkuSchema);

export const adminSkuDetailSchema = adminSkuSchema.extend({
  supplierOffers: z.array(skuOfferSchema),
});
export type AdminSkuDetail = z.infer<typeof adminSkuDetailSchema>;

const skuMutableFields = {
  code: z.string().trim().min(1).max(120),
  region: z.string().trim().min(2).max(8),
  currency: currencySchema.default("USD"),
  faceValue: decimalStringSchema,
  denominationLabel: z.string().trim().min(1).max(120),
  deliveryAssetType: deliveryAssetTypeSchema.default("CODE"),
  isActive: z.boolean().default(true),
  minQuantity: z.coerce.number().int().min(1).default(1),
  maxQuantity: z.coerce.number().int().min(1).max(100).default(10),
};
export const createSkuRequestSchema = z
  .object({ productId: idSchema, ...skuMutableFields })
  .refine((value) => value.maxQuantity >= value.minQuantity, {
    path: ["maxQuantity"],
    message: "حداکثر تعداد باید بزرگ‌تر یا مساوی حداقل تعداد باشد.",
  });
export type CreateSkuRequest = z.infer<typeof createSkuRequestSchema>;
export const updateSkuRequestSchema = z
  .object(skuMutableFields)
  .partial()
  .refine(
    (value) => value.minQuantity === undefined || value.maxQuantity === undefined || value.maxQuantity >= value.minQuantity,
    { path: ["maxQuantity"], message: "حداکثر تعداد باید بزرگ‌تر یا مساوی حداقل تعداد باشد." },
  );
export type UpdateSkuRequest = z.infer<typeof updateSkuRequestSchema>;

export const DELIVERY_ASSET_TYPE_LABELS: Record<z.infer<typeof deliveryAssetTypeSchema>, string> = {
  CODE: "کد",
  CODE_PIN: "کد + پین",
  PROVIDER_DIRECT_EMAIL: "ایمیل مستقیم تأمین‌کننده",
  URL: "لینک URL",
} as Record<z.infer<typeof deliveryAssetTypeSchema>, string>;

/* ============================================================================
 * Supplier
 *
 * `adminSupplierSchema` itself is declared above, alongside `skuOfferSchema`,
 * because a SKU's nested offer needs it before this section runs. Deliberately
 * has no credential/secret field: the API never returns one, and this schema
 * is also the ceiling on what the UI is capable of rendering.
 * ==========================================================================*/

export const INTEGRATION_MODE_VALUES = ["MANUAL", "API"] as const;
export const integrationModeSchema = z.enum(INTEGRATION_MODE_VALUES);
export type IntegrationMode = z.infer<typeof integrationModeSchema>;
export const INTEGRATION_MODE_LABELS: Record<IntegrationMode, string> = {
  MANUAL: "دستی",
  API: "اتصال API",
};

export const adminSupplierListSchema = paginatedSchema(adminSupplierSchema);

const supplierMutableFields = {
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  integrationMode: integrationModeSchema.default("MANUAL"),
  supportsRawCode: z.boolean().default(false),
  defaultCurrency: currencySchema.default("USD"),
  isActive: z.boolean().default(true),
  notes: z.string().max(4_000).nullable().optional(),
};
export const createSupplierRequestSchema = z.object(supplierMutableFields);
export type CreateSupplierRequest = z.infer<typeof createSupplierRequestSchema>;
export const updateSupplierRequestSchema = z.object(supplierMutableFields).partial();
export type UpdateSupplierRequest = z.infer<typeof updateSupplierRequestSchema>;

/* ============================================================================
 * Supplier offer
 *
 * `offerBaseFields` / `offerSkuSchema` are declared above for the same reason.
 * ==========================================================================*/

export const OFFER_AVAILABILITY_VALUES = ["AVAILABLE", "UNAVAILABLE"] as const;
export const offerAvailabilitySchema = z.enum(OFFER_AVAILABILITY_VALUES);
export type OfferAvailability = z.infer<typeof offerAvailabilitySchema>;
export const OFFER_AVAILABILITY_LABELS: Record<OfferAvailability, string> = {
  AVAILABLE: "موجود",
  UNAVAILABLE: "ناموجود",
};

export const adminOfferSchema = z.object({
  ...offerBaseFields,
  supplier: adminSupplierSchema.optional(),
  sku: offerSkuSchema.optional(),
});
export type AdminOffer = z.infer<typeof adminOfferSchema>;

export const adminOfferListSchema = paginatedSchema(adminOfferSchema);

/** A supplier's own offer list — same shape as `adminOfferSchema` minus the redundant `supplier`. */
const supplierOfferSchema = z.object({
  ...offerBaseFields,
  sku: offerSkuSchema.optional(),
});
export const adminSupplierDetailSchema = adminSupplierSchema.extend({
  offers: z.array(supplierOfferSchema),
});
export type AdminSupplierDetail = z.infer<typeof adminSupplierDetailSchema>;

const offerMutableFields = {
  costCurrency: currencySchema.default("USD"),
  costAmount: decimalStringSchema,
  discountBps: z.coerce.number().int().min(0).max(10_000).default(0),
  availability: offerAvailabilitySchema.default("AVAILABLE"),
  priority: z.coerce.number().int().min(0).default(100),
  isActive: z.boolean().default(true),
};
export const createOfferRequestSchema = z.object({
  supplierId: idSchema,
  skuId: idSchema,
  ...offerMutableFields,
});
export type CreateOfferRequest = z.infer<typeof createOfferRequestSchema>;
export const updateOfferRequestSchema = z.object(offerMutableFields).partial();
export type UpdateOfferRequest = z.infer<typeof updateOfferRequestSchema>;

/* ============================================================================
 * International service + service field
 * ==========================================================================*/

export const SERVICE_FIELD_TYPE_VALUES = ["TEXT", "EMAIL", "URL", "NUMBER", "SELECT", "TEXTAREA", "FILE"] as const;
export const serviceFieldTypeSchema = z.enum(SERVICE_FIELD_TYPE_VALUES);
export type ServiceFieldType = z.infer<typeof serviceFieldTypeSchema>;
export const SERVICE_FIELD_TYPE_LABELS: Record<ServiceFieldType, string> = {
  TEXT: "متن",
  EMAIL: "ایمیل",
  URL: "لینک",
  NUMBER: "عدد",
  SELECT: "لیست انتخابی",
  TEXTAREA: "متن چندخطی",
  FILE: "فایل",
};

export const adminServiceFieldSchema = z.object({
  id: idSchema,
  serviceId: idSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  labelFa: z.string().min(1),
  fieldType: serviceFieldTypeSchema,
  isRequired: z.boolean(),
  validationRegex: z.string().nullable(),
  helpTextFa: z.string().nullable(),
  options: z.array(z.object({ value: z.string(), labelFa: z.string() })).nullable(),
  sortOrder: z.number().int().min(0),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});
export type AdminServiceField = z.infer<typeof adminServiceFieldSchema>;

export const adminServiceSchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  nameFa: z.string().min(1),
  category: z.string().min(1),
  currency: currencySchema,
  minAmount: decimalStringSchema.nullable(),
  maxAmount: decimalStringSchema.nullable(),
  isActive: z.boolean(),
  requiresManualReview: z.boolean(),
  sortOrder: z.number().int(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  fields: z.array(adminServiceFieldSchema),
});
export type AdminService = z.infer<typeof adminServiceSchema>;

export const adminServiceListSchema = paginatedSchema(adminServiceSchema);

const serviceMutableFields = {
  slug: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  nameFa: z.string().trim().min(1).max(240),
  category: z.string().trim().min(1).max(120),
  currency: currencySchema.default("USD"),
  minAmount: decimalStringSchema.nullable().optional(),
  maxAmount: decimalStringSchema.nullable().optional(),
  isActive: z.boolean().default(true),
  requiresManualReview: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
};
export const createServiceRequestSchema = z.object(serviceMutableFields);
export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;
export const updateServiceRequestSchema = z.object(serviceMutableFields).partial();
export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;

const serviceFieldMutableFields = {
  key: z.string().trim().min(1).max(120),
  label: z.string().trim().min(1).max(240),
  labelFa: z.string().trim().min(1).max(240),
  fieldType: serviceFieldTypeSchema.default("TEXT"),
  isRequired: z.boolean().default(true),
  validationRegex: z.string().max(500).nullable().optional(),
  helpTextFa: z.string().max(1_000).nullable().optional(),
  sortOrder: z.coerce.number().int().min(0).default(0),
};
export const createServiceFieldRequestSchema = z.object({ serviceId: idSchema, ...serviceFieldMutableFields });
export type CreateServiceFieldRequest = z.infer<typeof createServiceFieldRequestSchema>;
export const updateServiceFieldRequestSchema = z.object(serviceFieldMutableFields).partial();
export type UpdateServiceFieldRequest = z.infer<typeof updateServiceFieldRequestSchema>;

/* ============================================================================
 * Shared list query
 * ==========================================================================*/

export interface AdminListQuery {
  page?: number;
  pageSize?: number;
  includeInactive?: boolean;
}

export function buildListSearch(query: AdminListQuery & Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === "") continue;
    params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `?${search}` : "";
}
