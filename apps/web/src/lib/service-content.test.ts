import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import index from "../content/international-service-index.json";
import articles from "../content/international-services.json";

describe("document service catalogue", () => {
  it("covers all 131 non-gift-card entries with unique routes and matching import records", () => {
    const manifest = JSON.parse(readFileSync(resolve(process.cwd(), "../../packages/database/prisma/international-services.json"), "utf8")) as {slug: string}[];
    expect(index).toHaveLength(131);
    expect(new Set(index.map((entry) => entry.slug)).size).toBe(131);
    expect(manifest.map((entry) => entry.slug)).toEqual(index.map((entry) => entry.slug));
    expect(Object.keys(articles)).toEqual(index.map((entry) => entry.slug));
    expect(index.every((entry) => entry.category !== "گیفت‌کارت")).toBe(true);
  });
  it("ships every referenced image locally, including shared pictures", () => {
    for (const article of Object.values(articles)) {
      const images = article.blocks.filter((block) => block.kind === "image");
      expect(images.length).toBeGreaterThan(0);
      for (const block of images) {
        if (!("src" in block) || !block.src) throw new Error("Missing image source");
        expect(existsSync(resolve(process.cwd(), "public", block.src.slice(1)))).toBe(true);
      }
    }
  });
  it("does not publish source branding or document editorial markers", () => {
    const renderedContent = JSON.stringify(articles);
    expect(renderedContent).not.toMatch(/پرداخت[\s\u200c]*پرو|IMG\d{4}|شناسه محتوا|راهنمای جای‌گذاری|یادداشت‌های داخلی پیش از انتشار/u);
  });
});
