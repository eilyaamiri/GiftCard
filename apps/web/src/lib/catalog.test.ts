import { describe, expect, it } from "vitest";

import {
  brandSchema,
  catalogProductSchema,
  catalogQueryString,
  categorySchema,
  listCategoriesResponseSchema,
} from "./catalog";

function categoryPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "cat_gaming",
    slug: "gaming",
    name: "Gaming",
    nameFa: "بازی و گیم",
    iconKey: "gamepad-2",
    descriptionFa: null,
    parentId: null,
    sortOrder: 20,
    productCount: 1700,
    ...overrides,
  };
}

function productPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1",
    slug: "steam-us",
    brand: "Steam",
    title: "Steam Wallet US",
    titleFa: "استیم والت آمریکا",
    description: null,
    descriptionFa: null,
    category: "Gaming",
    imageUrl: null,
    isActive: true,
    sortOrder: 0,
    regions: ["US"],
    createdAt: "2026-09-20T10:00:00.000Z",
    brandSlug: "steam",
    brandNameFa: "استیم",
    categorySlug: "gaming",
    categoryNameFa: "بازی و گیم",
    categoryIconKey: "gamepad-2",
    needsReview: false,
    isQuickPick: false,
    ...overrides,
  };
}

describe("categorySchema", () => {
  it("keeps an icon the storefront ships", () => {
    expect(categorySchema.parse(categoryPayload()).iconKey).toBe("gamepad-2");
  });

  it("falls back to the gift icon rather than rejecting the response", () => {
    /* An operator can type an icon name this build does not have. That is a
     * cosmetic mistake; failing the parse would blank the whole catalog page. */
    expect(categorySchema.parse(categoryPayload({ iconKey: "rocket-launch" })).iconKey).toBe("gift");
  });

  it("refuses a negative product count", () => {
    expect(() => categorySchema.parse(categoryPayload({ productCount: -1 }))).toThrow();
  });
});

describe("brandSchema", () => {
  it("reads a brand with its logo and popularity flag", () => {
    const brand = brandSchema.parse({
      id: "brnd_apple",
      slug: "apple",
      name: "Apple",
      nameFa: "اپل",
      logoUrl: "/brands/apple.png",
      descriptionFa: null,
      isPopular: true,
      sortOrder: 0,
      productCount: 3,
    });
    expect(brand).toMatchObject({ slug: "apple", isPopular: true, productCount: 3 });
  });
});

describe("catalogProductSchema", () => {
  it("carries the taxonomy keys on top of the contract's product", () => {
    const product = catalogProductSchema.parse(productPayload());
    expect(product).toMatchObject({ brandSlug: "steam", categorySlug: "gaming", needsReview: false });
    /* The contract's own fields must survive the extension, or every existing
     * product card silently loses its title. */
    expect(product.titleFa).toBe("استیم والت آمریکا");
  });

  it("accepts a product that has no brand or category yet", () => {
    const product = catalogProductSchema.parse(
      productPayload({
        brandSlug: null,
        brandNameFa: null,
        categorySlug: null,
        categoryNameFa: null,
        categoryIconKey: null,
        needsReview: true,
      }),
    );
    expect(product.needsReview).toBe(true);
    expect(product.categoryIconKey).toBeNull();
  });

  it("fails when the API forgets a taxonomy key instead of guessing one", () => {
    const { needsReview: _omitted, ...withoutFlag } = productPayload();
    expect(() => catalogProductSchema.parse(withoutFlag)).toThrow();
  });
});

describe("listCategoriesResponseSchema", () => {
  it("reads a list of categories", () => {
    const response = listCategoriesResponseSchema.parse({
      items: [categoryPayload(), categoryPayload({ slug: "console", iconKey: "joystick" })],
    });
    expect(response.items.map((item) => item.slug)).toEqual(["gaming", "console"]);
  });
});

describe("catalogQueryString", () => {
  it("is empty when nothing is filtered", () => {
    expect(catalogQueryString()).toBe("");
    expect(catalogQueryString({})).toBe("");
  });

  it("sends only the filters that are set", () => {
    expect(catalogQueryString({ categorySlug: "gaming", brandSlug: "steam" })).toBe(
      "categorySlug=gaming&brandSlug=steam",
    );
  });

  it("sends onlyAvailable=false, which is not the same as leaving it out", () => {
    /* The API defaults it to true. A catalog page that wants unbuyable products
     * listed has to say so explicitly, or its counts stop matching the tiles. */
    expect(catalogQueryString({ onlyAvailable: false })).toBe("onlyAvailable=false");
    expect(catalogQueryString({ onlyAvailable: undefined })).toBe("");
  });

  it("escapes a Persian search term", () => {
    expect(catalogQueryString({ search: "نتفلیکس" })).toBe(
      `search=${encodeURIComponent("نتفلیکس")}`,
    );
  });

  it("drops page 0 rather than asking for an invalid page", () => {
    expect(catalogQueryString({ page: 0, pageSize: 60 })).toBe("pageSize=60");
  });
});
