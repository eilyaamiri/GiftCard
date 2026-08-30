import { z } from 'zod';

import { deliveryAssetTypeSchema } from '../enums/operations';
import { positiveDecimalStringSchema, positiveIrrStringSchema } from '../money/schemas';
import { idSchema, isoDateTimeSchema, paginationMetaSchema } from './common';

/* ============================================================================
 * SKU
 * ==========================================================================*/

export const skuDtoSchema = z.object({
  id: idSchema,
  productId: idSchema,
  code: z.string().min(1),
  /** Region matters: an Apple US card is not redeemable on an Apple IR account. */
  region: z.string().min(2).max(8),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  faceValue: positiveDecimalStringSchema,
  denominationLabel: z.string().min(1),
  /**
   * How the value reaches the customer. Not every SKU yields a raw code — see
   * `DeliveryAssetType`.
   */
  deliveryAssetType: deliveryAssetTypeSchema,
  isActive: z.boolean(),
  minQuantity: z.number().int().min(1),
  maxQuantity: z.number().int().min(1),

  /**
   * Indicative customer price. NOT a quote and NOT payable — it is a display
   * figure computed with the current rate. Payment always uses a real quote.
   */
  indicativePriceIrr: positiveIrrStringSchema.nullable(),
  indicativePriceToman: positiveIrrStringSchema.nullable(),
  /** False when no supplier offer is currently available. */
  isAvailable: z.boolean(),
});
export type SkuDto = z.infer<typeof skuDtoSchema>;

/* ============================================================================
 * Product
 * ==========================================================================*/

export const productDtoSchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  brand: z.string().min(1),
  title: z.string().min(1),
  titleFa: z.string().min(1),
  description: z.string().nullable(),
  descriptionFa: z.string().nullable(),
  category: z.string().min(1),
  imageUrl: z.string().nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  /** Distinct regions across the product's active SKUs, for the region picker. */
  regions: z.array(z.string()),
  createdAt: isoDateTimeSchema,
});
export type ProductDto = z.infer<typeof productDtoSchema>;

export const productDetailDtoSchema = productDtoSchema.extend({
  skus: z.array(skuDtoSchema),
  /** Persian redemption instructions shown before purchase. */
  redemptionNotesFa: z.string().nullable(),
});
export type ProductDetailDto = z.infer<typeof productDetailDtoSchema>;

/* ============================================================================
 * GET /api/catalog/products  — listProducts
 * ==========================================================================*/

export const listProductsRequestSchema = z.object({
  category: z.string().optional(),
  brand: z.string().optional(),
  region: z.string().optional(),
  search: z.string().max(120).optional(),
  onlyAvailable: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type ListProductsRequest = z.infer<typeof listProductsRequestSchema>;

export const listProductsResponseSchema = z.object({
  items: z.array(productDtoSchema),
  meta: paginationMetaSchema,
});
export type ListProductsResponse = z.infer<typeof listProductsResponseSchema>;

/* ============================================================================
 * GET /api/catalog/products/:slug  — getProduct
 * ==========================================================================*/

export const getProductRequestSchema = z.object({
  slug: z.string().min(1),
  region: z.string().optional(),
});
export type GetProductRequest = z.infer<typeof getProductRequestSchema>;

export const getProductResponseSchema = z.object({
  product: productDetailDtoSchema,
});
export type GetProductResponse = z.infer<typeof getProductResponseSchema>;

/* ============================================================================
 * International services
 * ==========================================================================*/

export const serviceFieldDefinitionDtoSchema = z.object({
  id: idSchema,
  key: z.string().min(1),
  label: z.string().min(1),
  labelFa: z.string().min(1),
  fieldType: z.enum(['TEXT', 'EMAIL', 'URL', 'NUMBER', 'SELECT', 'TEXTAREA', 'FILE']),
  isRequired: z.boolean(),
  validationRegex: z.string().nullable(),
  helpTextFa: z.string().nullable(),
  options: z.array(z.object({ value: z.string(), labelFa: z.string() })).nullable(),
  sortOrder: z.number().int().min(0),
});
export type ServiceFieldDefinitionDto = z.infer<typeof serviceFieldDefinitionDtoSchema>;

export const internationalServiceDtoSchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  nameFa: z.string().min(1),
  category: z.string().min(1),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  minAmount: positiveDecimalStringSchema.nullable(),
  maxAmount: positiveDecimalStringSchema.nullable(),
  isActive: z.boolean(),
  requiresManualReview: z.boolean(),
  fields: z.array(serviceFieldDefinitionDtoSchema),
});
export type InternationalServiceDto = z.infer<typeof internationalServiceDtoSchema>;

export const listServicesResponseSchema = z.object({
  items: z.array(internationalServiceDtoSchema),
  meta: paginationMetaSchema,
});
export type ListServicesResponse = z.infer<typeof listServicesResponseSchema>;
