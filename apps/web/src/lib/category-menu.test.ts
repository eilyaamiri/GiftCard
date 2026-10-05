import { describe, expect, it } from "vitest";

import { categorySchema, type Category } from "./catalog";
import { buildCategoryMenu, buildCategoryStrip } from "./category-menu";

function category(overrides: Record<string, unknown> = {}): Category {
  return categorySchema.parse({
    id: "cat_gaming",
    slug: "gaming",
    name: "Gaming",
    nameFa: "بازی و گیم",
    iconKey: "gamepad-2",
    descriptionFa: null,
    parentId: null,
    sortOrder: 20,
    productCount: 10,
    ...overrides,
  });
}

const utility = category({
  id: "cat_utility_software",
  slug: "utility-software",
  nameFa: "نرم‌افزارهای کاربردی",
  iconKey: "app-window",
  kind: "SERVICES",
  productCount: 0,
  links: [
    { id: "l1", type: "TOP_UP_GAME", slug: "capcut", title: "کپ‌کات", imageUrl: null },
    { id: "l2", type: "TOP_UP_GAME", slug: "telegram-stars", title: "تلگرام", imageUrl: null },
  ],
});
const games = category({ id: "cat_games", slug: "games", nameFa: "بازی‌ها", kind: "SERVICES", productCount: 0, links: [{ id: "l3", type: "PRODUCT", slug: "steam-us", title: "استیم", imageUrl: null }] });
const emptyList = category({ id: "cat_empty", slug: "empty", nameFa: "خالی", kind: "SERVICES", productCount: 0, links: [] });

describe("categorySchema", () => {
  it("treats a payload without kind or links as a product category", () => {
    const parsed = category();
    expect(parsed.kind).toBe("PRODUCTS");
    expect(parsed.links).toEqual([]);
  });
});

describe("buildCategoryMenu", () => {
  it("puts the gift-card umbrella first, holding the product categories", () => {
    const sections = buildCategoryMenu([category(), utility, games]);
    expect(sections.map((section) => section.label)).toEqual(["گیفت‌کارت‌ها", "نرم‌افزارهای کاربردی", "بازی‌ها"]);
    expect(sections[0]?.entries.map((entry) => entry.href)).toEqual(["/gift-cards?category=gaming"]);
  });

  it("links service-list entries to the page of the service itself", () => {
    const [, utilitySection, gamesSection] = buildCategoryMenu([category(), utility, games]);
    expect(utilitySection?.href).toBe("/categories/utility-software");
    expect(utilitySection?.entries.map((entry) => entry.href)).toEqual(["/games/capcut", "/games/telegram-stars"]);
    expect(gamesSection?.entries[0]?.href).toBe("/gift-cards/steam-us");
  });

  it("omits a service list with nothing to show and an umbrella with no products", () => {
    expect(buildCategoryMenu([emptyList]).length).toBe(0);
    expect(buildCategoryMenu([utility]).map((section) => section.label)).toEqual(["نرم‌افزارهای کاربردی"]);
  });
});

describe("buildCategoryStrip", () => {
  it("shows gift-card categories then the utility-software links, but not games", () => {
    const strip = buildCategoryStrip([category(), utility, games]);
    expect(strip.map((entry) => entry.label)).toEqual(["بازی و گیم", "کپ‌کات", "تلگرام"]);
  });

  it("is just the gift-card categories while utility software is empty", () => {
    expect(buildCategoryStrip([category(), emptyList]).map((entry) => entry.label)).toEqual(["بازی و گیم"]);
  });
});
