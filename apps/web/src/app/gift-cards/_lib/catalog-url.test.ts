import { describe, expect, it } from "vitest";

import {
  CATALOG_PAGE_SIZE,
  catalogHref,
  hasActiveFilter,
  readCatalogFilters,
} from "./catalog-url";

describe("readCatalogFilters", () => {
  it("starts on the first page with nothing filtered", () => {
    expect(readCatalogFilters({})).toEqual({
      category: undefined,
      brand: undefined,
      region: undefined,
      q: undefined,
      page: 1,
    });
    expect(CATALOG_PAGE_SIZE).toBe(24);
  });

  it("falls back to page 1 for anything that is not a page number", () => {
    // The API floors `page` at 1 and 400s below it, which would replace the
    // catalog with an error page.
    expect(readCatalogFilters({ page: "abc" }).page).toBe(1);
    expect(readCatalogFilters({ page: "0" }).page).toBe(1);
    expect(readCatalogFilters({ page: "-3" }).page).toBe(1);
    expect(readCatalogFilters({ page: "4" }).page).toBe(4);
  });

  it("treats a blank value as no filter at all", () => {
    // `?category=` must list the whole catalog, not filter on an empty slug.
    expect(readCatalogFilters({ category: "   ", q: "" }).category).toBeUndefined();
    expect(readCatalogFilters({ category: "   ", q: "" }).q).toBeUndefined();
  });

  it("truncates hand-typed values to the lengths the API accepts", () => {
    const filters = readCatalogFilters({
      category: "c".repeat(200),
      brand: "b".repeat(200),
      region: "r".repeat(40),
      q: "q".repeat(300),
    });

    expect(filters.category).toHaveLength(90);
    expect(filters.brand).toHaveLength(90);
    expect(filters.region).toHaveLength(8);
    expect(filters.q).toHaveLength(120);
  });

  it("reads the first value when a parameter is repeated", () => {
    expect(readCatalogFilters({ category: ["gaming", "travel"] }).category).toBe("gaming");
  });
});

describe("catalogHref", () => {
  it("carries every filter across a page change", () => {
    const filters = readCatalogFilters({
      category: "gaming",
      brand: "steam",
      region: "US",
      q: "استیم",
      page: "2",
    });

    expect(catalogHref(filters, { page: 3 })).toBe(
      "/gift-cards?category=gaming&brand=steam&region=US&q=%D8%A7%D8%B3%D8%AA%DB%8C%D9%85&page=3",
    );
  });

  it("returns to the first page when a filter changes", () => {
    const filters = readCatalogFilters({ category: "gaming", page: "9" });

    // A newly narrowed result set has no page 9 to land on.
    expect(catalogHref(filters, { brand: "steam" })).toBe("/gift-cards?category=gaming&brand=steam");
  });

  it("clears one filter without disturbing the others", () => {
    const filters = readCatalogFilters({ category: "gaming", brand: "steam", region: "US" });

    expect(catalogHref(filters, { brand: undefined })).toBe("/gift-cards?category=gaming&region=US");
  });

  it("drops back to the bare catalog when everything is cleared", () => {
    const filters = readCatalogFilters({ category: "gaming", page: "5" });

    expect(catalogHref(filters, { category: undefined })).toBe("/gift-cards");
  });

  it("encodes a Persian term instead of letting it break the URL", () => {
    const href = catalogHref(readCatalogFilters({}), { q: "گیفت & کارت" });

    expect(href).not.toContain(" ");
    expect(new URL(href, "https://baratpay.com").searchParams.get("q")).toBe("گیفت & کارت");
  });

  it("can point the same filters at another page", () => {
    const filters = readCatalogFilters({ brand: "steam" });

    expect(catalogHref(filters, {}, "/brands")).toBe("/brands?brand=steam");
  });
});

describe("hasActiveFilter", () => {
  it("ignores the page number", () => {
    // Page 3 of the unfiltered catalog has nothing to clear.
    expect(hasActiveFilter(readCatalogFilters({ page: "3" }))).toBe(false);
  });

  it("is true for any one of the four filters", () => {
    for (const key of ["category", "brand", "region", "q"]) {
      expect(hasActiveFilter(readCatalogFilters({ [key]: "x" }))).toBe(true);
    }
  });
});
