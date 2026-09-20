/**
 * The catalog shapes the storefront navigates by.
 *
 * `@barat/contracts` has `productDtoSchema`, but it predates the `Brand` and
 * `Category` tables and its `brand`/`category` fields are the supplier's
 * free-text strings. The package is frozen to Foundation, so the extra keys the
 * API now returns are described here instead — as extensions of the contract
 * schemas, not restatements of them, so a drift in the shared part still fails
 * at the boundary. `apps/api/src/modules/catalog/catalog-taxonomy.dto.ts` is
 * the other half of this pair; the two move together.
 */

import { z } from "zod";
import { productDtoSchema, productDetailDtoSchema } from "@barat/contracts";
import type { skuDtoSchema } from "@barat/contracts";

/** Icons the storefront is willing to draw, by `iconKey`. */
export const CATEGORY_ICON_KEYS = [
  "sparkles",
  "gamepad-2",
  "joystick",
  "clapperboard",
  "shopping-bag",
  "smartphone",
  "app-window",
  "book-open",
  "utensils",
  "plane",
  "dumbbell",
  "cpu",
  "sofa",
  "flower-2",
  "credit-card",
  "wallet",
  "ellipsis",
  "gift",
] as const;

export type CategoryIconKey = (typeof CATEGORY_ICON_KEYS)[number];

/**
 * An unknown `iconKey` falls back to the gift icon rather than failing the
 * response. An operator naming an icon this build does not ship is a cosmetic
 * mistake; it must not take the catalog page down with it.
 */
const iconKeySchema = z
  .string()
  .transform((value): CategoryIconKey =>
    (CATEGORY_ICON_KEYS as readonly string[]).includes(value) ? (value as CategoryIconKey) : "gift",
  );

export const categorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  nameFa: z.string(),
  iconKey: iconKeySchema,
  descriptionFa: z.string().nullable(),
  parentId: z.string().nullable(),
  sortOrder: z.number().int(),
  productCount: z.number().int().nonnegative(),
});

export const brandSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  nameFa: z.string(),
  logoUrl: z.string().nullable(),
  descriptionFa: z.string().nullable(),
  isPopular: z.boolean(),
  sortOrder: z.number().int(),
  productCount: z.number().int().nonnegative(),
});

const taxonomyKeys = {
  brandSlug: z.string().nullable(),
  brandNameFa: z.string().nullable(),
  categorySlug: z.string().nullable(),
  categoryNameFa: z.string().nullable(),
  categoryIconKey: iconKeySchema.nullable(),
  /** Incomplete data: shown in the catalog, but not orderable. */
  needsReview: z.boolean(),
  isQuickPick: z.boolean(),
};

export const catalogProductSchema = productDtoSchema.extend(taxonomyKeys);
export const catalogProductDetailSchema = productDetailDtoSchema.extend(taxonomyKeys);

export const listCategoriesResponseSchema = z.object({ items: z.array(categorySchema) });
export const listBrandsResponseSchema = z.object({ items: z.array(brandSchema) });
export const listCatalogProductsResponseSchema = z.object({
  items: z.array(catalogProductSchema),
  /**
   * The regions worth offering for the filters currently applied, computed by
   * the API. The catalog spans 158 of them, so the picker cannot be a list the
   * frontend keeps.
   */
  regions: z.array(z.string()),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export const getCatalogProductResponseSchema = z.object({ product: catalogProductDetailSchema });

export type Category = z.infer<typeof categorySchema>;
export type Brand = z.infer<typeof brandSchema>;
export type CatalogProduct = z.infer<typeof catalogProductSchema>;
export type CatalogProductDetail = z.infer<typeof catalogProductDetailSchema>;
export type ListCategoriesResponse = z.infer<typeof listCategoriesResponseSchema>;
export type ListBrandsResponse = z.infer<typeof listBrandsResponseSchema>;
export type ListCatalogProductsResponse = z.infer<typeof listCatalogProductsResponseSchema>;
export type GetCatalogProductResponse = z.infer<typeof getCatalogProductResponseSchema>;
export type CatalogSku = z.infer<typeof skuDtoSchema>;

/** The filters `/api/catalog/products` understands. */
export interface CatalogQuery {
  readonly categorySlug?: string | undefined;
  readonly brandSlug?: string | undefined;
  readonly region?: string | undefined;
  readonly search?: string | undefined;
  readonly page?: number | undefined;
  readonly pageSize?: number | undefined;
  /**
   * Defaults to true on the API. The catalog page passes false: a product with
   * no priced offer is still listed, it just cannot be bought — hiding it would
   * make the category counts disagree with what the page shows.
   */
  readonly onlyAvailable?: boolean | undefined;
}

export function catalogQueryString(query: CatalogQuery = {}): string {
  const search = new URLSearchParams();
  if (query.categorySlug) search.set("categorySlug", query.categorySlug);
  if (query.brandSlug) search.set("brandSlug", query.brandSlug);
  if (query.region) search.set("region", query.region);
  if (query.search) search.set("search", query.search);
  if (query.page) search.set("page", String(query.page));
  if (query.pageSize) search.set("pageSize", String(query.pageSize));
  if (query.onlyAvailable !== undefined) search.set("onlyAvailable", String(query.onlyAvailable));
  return search.toString();
}
