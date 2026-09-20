/**
 * The shapes the storefront navigates the catalog by.
 *
 * These belong in `@barat/contracts` with the rest of the catalog DTOs, but
 * that package is frozen to Foundation, so they live here and the web app keeps
 * its own copy. When the freeze lifts, move this file and delete the copy —
 * `ProductDto` below is deliberately a superset of the contract's, so nothing
 * has to change at the call sites when it does.
 */

import type { ProductDetailDto, ProductDto } from '@barat/contracts';

/** A storefront category, with the number of products actually in it. */
export interface CategoryDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly nameFa: string;
  /** Names an icon in the web app's allow-list. Never a URL. */
  readonly iconKey: string;
  readonly descriptionFa: string | null;
  readonly parentId: string | null;
  readonly sortOrder: number;
  /** Active products in this category, primary and secondary together. */
  readonly productCount: number;
}

export interface BrandDto {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly nameFa: string;
  readonly logoUrl: string | null;
  readonly descriptionFa: string | null;
  /** Curated by an operator. There is no traffic data to rank brands by. */
  readonly isPopular: boolean;
  readonly sortOrder: number;
  readonly productCount: number;
}

export interface ListCategoriesResponse {
  readonly items: readonly CategoryDto[];
}

export interface ListBrandsResponse {
  readonly items: readonly BrandDto[];
}

/**
 * The contract's product, plus the taxonomy keys.
 *
 * `brand` and `category` in `ProductDto` are the supplier's free-text strings;
 * they are kept because the contract and the admin screens still read them, but
 * a storefront that wants a brand logo or a category icon needs the slug.
 */
export interface CatalogProductDto extends ProductDto {
  readonly brandSlug: string | null;
  readonly brandNameFa: string | null;
  readonly categorySlug: string | null;
  readonly categoryNameFa: string | null;
  readonly categoryIconKey: string | null;
  /**
   * Data is incomplete. The product is still listed — the brief is explicit
   * that nothing is hidden for it — but it cannot be bought.
   */
  readonly needsReview: boolean;
  readonly isQuickPick: boolean;
}

/** The product page's payload: the detail contract plus the taxonomy keys. */
export interface CatalogProductDetailDto
  extends CatalogProductDto,
    Pick<ProductDetailDto, 'redemptionNotesFa' | 'skus'> {}

export interface GetCatalogProductResponse {
  readonly product: CatalogProductDetailDto;
}

export interface ListCatalogProductsResponse {
  readonly items: readonly CatalogProductDto[];
  /**
   * The regions the storefront's region filter should offer.
   *
   * Computed from the same result set the page is showing, minus an active
   * region filter — otherwise picking «US» would leave «US» as the only option
   * and there would be no way back to the rest. The catalog spans 158 regions,
   * so this cannot be a fixed list in the frontend.
   */
  readonly regions: readonly string[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    readonly totalPages: number;
  };
}
