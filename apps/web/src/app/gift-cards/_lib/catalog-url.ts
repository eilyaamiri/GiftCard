/**
 * The catalog's state lives in the URL.
 *
 * Every filter is a query parameter rather than client state, so a filtered
 * catalog can be linked, bookmarked, reloaded and reached with the back button,
 * and so the page can be rendered on the server — the category and brand lists
 * come from the API, and nothing about them is known at build time.
 *
 * `searchParams` is untrusted: anyone can type it. Whatever comes out of here is
 * forwarded straight to an API that rejects a slug over 90 characters or a page
 * below 1, so the coercion is the boundary.
 */

/** Rows per page. Three columns on desktop, two on a phone — both divide it. */
export const CATALOG_PAGE_SIZE = 24;

/** `slugSchema` on the API is `.max(90)`, and `search` is `.max(120)`. */
const SLUG_MAX = 90;
const SEARCH_MAX = 120;
const REGION_MAX = 8;

export interface CatalogFilters {
  readonly category?: string | undefined;
  readonly brand?: string | undefined;
  readonly region?: string | undefined;
  readonly q?: string | undefined;
  readonly page: number;
}

export type RawSearchParams = Record<string, string | string[] | undefined>;

function first(params: RawSearchParams, key: string): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  if (single === undefined) return undefined;
  const trimmed = single.trim();
  return trimmed === "" ? undefined : trimmed;
}

export function readCatalogFilters(params: RawSearchParams): CatalogFilters {
  const rawPage = Number.parseInt(first(params, "page") ?? "1", 10);
  return {
    category: first(params, "category")?.slice(0, SLUG_MAX),
    brand: first(params, "brand")?.slice(0, SLUG_MAX),
    region: first(params, "region")?.slice(0, REGION_MAX),
    q: first(params, "q")?.slice(0, SEARCH_MAX),
    page: Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1,
  };
}

/**
 * A catalog link with one thing changed.
 *
 * Changing a filter returns to page one: there is no page 7 of a result set the
 * customer has just narrowed, and landing on an empty page reads as "nothing
 * found". An explicit `page` override is the one case that keeps its value.
 */
export function catalogHref(
  filters: CatalogFilters,
  overrides: Partial<CatalogFilters> = {},
  pathname = "/gift-cards",
): string {
  const merged: CatalogFilters = { ...filters, ...overrides, page: overrides.page ?? 1 };
  const search = new URLSearchParams();
  if (merged.category) search.set("category", merged.category);
  if (merged.brand) search.set("brand", merged.brand);
  if (merged.region) search.set("region", merged.region);
  if (merged.q) search.set("q", merged.q);
  if (merged.page > 1) search.set("page", String(merged.page));
  const suffix = search.toString();
  return suffix ? `${pathname}?${suffix}` : pathname;
}

/** Whether anything is narrowing the catalog, i.e. whether «پاک کردن» applies. */
export function hasActiveFilter(filters: CatalogFilters): boolean {
  return Boolean(filters.category ?? filters.brand ?? filters.region ?? filters.q);
}
