import { api, ApiClientError } from "./api";
import { visibleBrandsQuery } from "./brand-art";
import type { Brand, Category } from "./catalog";

/**
 * Categories and brands for the header's dropdown menus.
 *
 * Fetched once per request in the root layout, alongside the session and the
 * support channels — a slow or failing catalog must not take the page chrome
 * down with it, so this degrades to two empty lists instead of throwing.
 */
export interface NavFacets {
  readonly categories: readonly Category[];
  readonly brands: readonly Brand[];
}

export async function getNavFacets(): Promise<NavFacets> {
  try {
    const [categories, brands] = await Promise.all([
      api.categories(visibleBrandsQuery()).then((response) => response.items),
      api.brands(visibleBrandsQuery()).then((response) => response.items),
    ]);
    return { categories, brands };
  } catch (error) {
    if (error instanceof ApiClientError) return { categories: [], brands: [] };
    throw error;
  }
}
