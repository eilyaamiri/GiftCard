import { describe, expect, it } from "vitest";

import {
  breadcrumbJsonLd,
  brandPath,
  catalogCanonicalPath,
  itemListJsonLd,
  faqJsonLd,
  pageMetadata,
  productJsonLd,
  productSeo,
  truncateForMeta,
} from "./seo";

const ORIGIN = "https://www.centohub.com";

describe("truncateForMeta", () => {
  it("returns a short text unchanged apart from whitespace and markdown marks", () => {
    expect(truncateForMeta("  **گیفت‌کارت**\n\n اپل  ")).toBe("گیفت‌کارت اپل");
  });

  it("cuts a long text at a word boundary and adds an ellipsis", () => {
    const long = "کلمه ".repeat(80);
    const out = truncateForMeta(long, 60);
    expect(Array.from(out).length).toBeLessThanOrEqual(60);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toMatch(/\s…$/u);
  });

  it("counts characters, not UTF-16 units", () => {
    expect(truncateForMeta("😀".repeat(10), 10)).toBe("😀".repeat(10));
  });
});

describe("productSeo", () => {
  it("builds a keyword title and leaves the brand template to the layout", () => {
    expect(productSeo({ titleFa: "گیفت‌کارت اپل", descriptionFa: null, regions: [] }).title).toBe(
      "خرید گیفت‌کارت اپل با قیمت روز",
    );
  });

  it("uses the product's own description when it is long enough to say something", () => {
    const own = "این گیفت‌کارت برای اکانت اپل آمریکا است و برای خرید اپلیکیشن و اشتراک استفاده می‌شود.";
    expect(productSeo({ titleFa: "اپل", descriptionFa: own, regions: ["US"] }).description).toBe(own);
  });

  it("falls back to a plain sentence naming the regions, and claims no price or delivery time", () => {
    const { description } = productSeo({ titleFa: "گیفت‌کارت اپل", descriptionFa: "کوتاه", regions: ["US", "TR"] });
    expect(description).toContain("گیفت‌کارت اپل");
    expect(description).toContain("منطقه‌های موجود");
    expect(description).not.toMatch(/لحظه|دقیقه|تومان|ریال \d/u);
  });

  it("names at most five regions", () => {
    const { description } = productSeo({
      titleFa: "اپل",
      descriptionFa: null,
      regions: ["US", "TR", "DE", "GB", "FR", "IT", "ES"],
    });
    expect(description.split("،").length).toBeLessThanOrEqual(5);
  });

  it("omits the region clause when there are no regions", () => {
    expect(productSeo({ titleFa: "اپل", descriptionFa: null, regions: [] }).description).not.toContain("منطقه‌های");
  });
});

describe("pageMetadata", () => {
  it("sets the canonical, and writes openGraph and twitter out in full", () => {
    const meta = pageMetadata({ title: "خرید اپل", description: "توضیح", path: "/gift-cards/apple", imageUrl: "/uploads/a.webp" });
    expect(meta.alternates).toEqual({ canonical: "/gift-cards/apple" });
    expect(meta.openGraph).toMatchObject({
      siteName: "CENTO",
      locale: "fa_IR",
      title: "خرید اپل | سنتو",
      url: "/gift-cards/apple",
      images: [{ url: `${ORIGIN}/uploads/a.webp`, alt: "خرید اپل" }],
    });
    expect(meta.twitter).toMatchObject({ card: "summary_large_image", title: "خرید اپل | سنتو" });
  });

  it("keeps an absolute image URL as it is", () => {
    const meta = pageMetadata({ title: "t", path: "/x", imageUrl: "https://cdn.example/x.png" });
    expect(meta.openGraph).toMatchObject({ images: [{ url: "https://cdn.example/x.png" }] });
  });

  it("falls back to the brand image and a small card without a product image", () => {
    const meta = pageMetadata({ title: "t", path: "/x" });
    expect(meta.twitter).toMatchObject({ card: "summary" });
    expect(JSON.stringify(meta.openGraph)).toContain("cento-og.png");
    expect(meta.description).toBeUndefined();
  });

  it("marks a page noindex only when asked", () => {
    expect(pageMetadata({ title: "t", path: "/x" }).robots).toBeUndefined();
    expect(pageMetadata({ title: "t", path: "/x", noindex: true }).robots).toEqual({ index: false, follow: true });
  });
});

describe("breadcrumbJsonLd", () => {
  it("numbers the crumbs from one and gives each an absolute URL", () => {
    const data = breadcrumbJsonLd([
      { name: "خانه", path: "/" },
      { name: "اپل", path: "/gift-cards/apple" },
    ]);
    expect(data["@type"]).toBe("BreadcrumbList");
    expect(data["itemListElement"]).toEqual([
      { "@type": "ListItem", position: 1, name: "خانه", item: `${ORIGIN}/` },
      { "@type": "ListItem", position: 2, name: "اپل", item: `${ORIGIN}/gift-cards/apple` },
    ]);
  });
});

describe("faqJsonLd", () => {
  it("is null for no entries, so no empty FAQPage is rendered", () => {
    expect(faqJsonLd(null)).toBeNull();
    expect(faqJsonLd(undefined)).toBeNull();
    expect(faqJsonLd([])).toBeNull();
  });

  it("maps each entry to a Question with an accepted Answer", () => {
    const data = faqJsonLd([{ question: "چطور؟", answer: "اینطور." }]);
    expect(data?.["@type"]).toBe("FAQPage");
    expect(data?.["mainEntity"]).toEqual([
      { "@type": "Question", name: "چطور؟", acceptedAnswer: { "@type": "Answer", text: "اینطور." } },
    ]);
  });
});

describe("productJsonLd", () => {
  const base = {
    name: "گیفت‌کارت اپل",
    description: "توضیح",
    path: "/gift-cards/apple",
    imageUrl: "/uploads/a.webp",
    brand: "Apple",
    summary: null,
  };

  it("never carries offers or a price", () => {
    const text = JSON.stringify(productJsonLd(base));
    expect(text).not.toContain("offers");
    expect(text).not.toContain("price");
  });

  it("describes the product with an absolute URL and image and a Brand", () => {
    const data = productJsonLd(base);
    expect(data).toMatchObject({
      "@type": "Product",
      name: "گیفت‌کارت اپل",
      url: `${ORIGIN}/gift-cards/apple`,
      image: `${ORIGIN}/uploads/a.webp`,
      brand: { "@type": "Brand", name: "Apple" },
    });
  });

  it("adds aggregateRating only when approved reviews exist", () => {
    expect(productJsonLd(base)["aggregateRating"]).toBeUndefined();
    expect(productJsonLd({ ...base, summary: { average: null, count: 0, distribution: {} } as never })["aggregateRating"]).toBeUndefined();
    expect(productJsonLd({ ...base, summary: { average: 4.5, count: 0 } as never })["aggregateRating"]).toBeUndefined();
    expect(productJsonLd({ ...base, summary: { average: 4.5, count: 12 } as never })["aggregateRating"]).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 12,
      bestRating: 5,
      worstRating: 1,
    });
  });

  it("leaves out the image and brand when there are none", () => {
    const data = productJsonLd({ ...base, imageUrl: null, brand: null });
    expect(data["image"]).toBeUndefined();
    expect(data["brand"]).toBeUndefined();
    expect(productJsonLd({ ...base, brand: "" })["brand"]).toBeUndefined();
  });
});

describe("catalogCanonicalPath", () => {
  it("is the bare catalogue without filters", () => {
    expect(catalogCanonicalPath({})).toBe("/gift-cards");
  });

  it("keeps a category as its own address", () => {
    expect(catalogCanonicalPath({ category: "gaming" })).toBe("/gift-cards?category=gaming");
  });

  it("points a brand alone at the brand's own page", () => {
    expect(catalogCanonicalPath({ brand: "apple" })).toBe("/brands/apple");
  });

  it("keeps a category and a brand together in the catalogue", () => {
    expect(catalogCanonicalPath({ category: "gaming", brand: "apple" })).toBe("/gift-cards?category=gaming&brand=apple");
  });

  it("keeps a later page, but not the first", () => {
    expect(catalogCanonicalPath({ brand: "apple", page: 3 })).toBe("/brands/apple?page=3");
    expect(catalogCanonicalPath({ brand: "apple", page: 1 })).toBe("/brands/apple");
    expect(catalogCanonicalPath({ category: "gaming", page: 2 })).toBe("/gift-cards?category=gaming&page=2");
  });

  it("encodes a slug rather than trusting it", () => {
    expect(catalogCanonicalPath({ category: "a b&c" })).toBe("/gift-cards?category=a+b%26c");
    expect(brandPath("a b&c")).toBe("/brands/a%20b%26c");
  });
});

describe("itemListJsonLd", () => {
  it("numbers the items from one with absolute URLs", () => {
    expect(itemListJsonLd([{ name: "اپل", path: "/gift-cards/apple" }])["itemListElement"]).toEqual([
      { "@type": "ListItem", position: 1, name: "اپل", url: `${ORIGIN}/gift-cards/apple` },
    ]);
  });
});
