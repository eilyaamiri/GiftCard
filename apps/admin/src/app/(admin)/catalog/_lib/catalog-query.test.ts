import { describe, expect, it } from "vitest";

import {
  CATALOG_PAGE_SIZE,
  buildListSearch,
  catalogHref,
  readCatalogQuery,
} from "./catalog-contracts";

/**
 * `searchParams` is untrusted — anyone can hand-type the URL — and whatever
 * comes out of it is forwarded straight to an API that 400s on a page below 1
 * or a search over 120 characters. These cover the coercion rather than the
 * rendering.
 */
describe("readCatalogQuery", () => {
  it("asks for twenty rows from the first page by default", () => {
    expect(readCatalogQuery({})).toEqual({ page: 1, pageSize: CATALOG_PAGE_SIZE, status: "ALL" });
    expect(CATALOG_PAGE_SIZE).toBe(20);
  });

  it("falls back to page 1 for anything that is not a page number", () => {
    // The API's schema floors `page` at 1, so forwarding these would 400 the
    // screen instead of showing the catalog.
    expect(readCatalogQuery({ page: "abc" }).page).toBe(1);
    expect(readCatalogQuery({ page: "-4" }).page).toBe(1);
    expect(readCatalogQuery({ page: "0" }).page).toBe(1);
    expect(readCatalogQuery({ page: "7" }).page).toBe(7);
  });

  it("accepts only the two explicit status filters", () => {
    expect(readCatalogQuery({ status: "ACTIVE" }).status).toBe("ACTIVE");
    expect(readCatalogQuery({ status: "INACTIVE" }).status).toBe("INACTIVE");
    expect(readCatalogQuery({ status: "unknown" }).status).toBe("ALL");
  });

  it("truncates a search term to the length the API accepts", () => {
    expect(readCatalogQuery({ search: "x".repeat(200) }).search).toHaveLength(120);
  });

  it("treats a blank term as no search at all", () => {
    // `?search=` must list the catalog rather than filter it on an empty string.
    expect(readCatalogQuery({ search: "   " }).search).toBeUndefined();
  });
});

describe("catalog list URLs", () => {
  it("builds a query the products endpoint accepts", () => {
    const query = readCatalogQuery({ page: "3", search: "14971" });
    const params = new URLSearchParams(
      buildListSearch({
        page: query.page,
        pageSize: query.pageSize,
        includeInactive: true,
        search: query.search,
      }).slice(1),
    );

    expect(params.get("page")).toBe("3");
    expect(params.get("pageSize")).toBe("20");
    // The imported catalog is entirely inactive; without this the screen is empty.
    expect(params.get("includeInactive")).toBe("true");
    expect(params.get("search")).toBe("14971");
  });

  it("encodes a term instead of letting it break the URL", () => {
    const search = buildListSearch({
      page: 1,
      pageSize: 20,
      includeInactive: true,
      search: "گیفت & کارت",
    });

    expect(search).not.toContain(" ");
    expect(new URLSearchParams(search.slice(1)).get("search")).toBe("گیفت & کارت");
  });

  it("carries the search across a page change", () => {
    const query = readCatalogQuery({ search: "apple", page: "2" });

    // Losing the term on "next page" would silently page the whole catalog.
    expect(catalogHref("/catalog", query, { page: 3 })).toBe("/catalog?search=apple&page=3");
  });

  it("returns to the first page when the term changes", () => {
    const query = readCatalogQuery({ search: "apple", page: "9" });

    // A new search has no page 9 to land on.
    expect(catalogHref("/catalog", query, { search: "steam" })).toBe("/catalog?search=steam");
  });

  it("drops both the term and the page when the search is cleared", () => {
    const query = readCatalogQuery({ search: "apple", page: "9" });

    expect(catalogHref("/catalog", query, { search: "" })).toBe("/catalog");
  });
});
