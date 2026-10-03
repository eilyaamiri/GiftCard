import { afterEach, describe, expect, it, vi } from "vitest";
import { BRAND, absoluteUrl, copyrightYear, siteUrl, withCurrentBrandName } from "./brand";

afterEach(() => vi.unstubAllEnvs());

describe("siteUrl", () => {
  it("defaults to the production domain", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    expect(siteUrl()).toBe("https://centopay.ir");
  });

  it("lets a staging host advertise itself, without a trailing slash", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.example/");
    expect(siteUrl()).toBe("https://staging.example");
    expect(absoluteUrl("help")).toBe("https://staging.example/help");
  });
});

describe("BRAND", () => {
  it("keeps the hero headline verbatim and breaks it on a word it contains", () => {
    expect(BRAND.hero.title).toBe("چیزی که در جهان می‌خواهید، با ریال در دسترس شماست.");
    expect(BRAND.hero.title.split(" ")).toContain(BRAND.hero.breakAfter);
  });
});

describe("copyrightYear", () => {
  it("prints the Persian-calendar year in Persian digits", () => {
    expect(copyrightYear(new Date("2026-10-03T12:00:00Z"))).toBe("۱۴۰۵");
  });
});

describe("withCurrentBrandName", () => {
  it("maps the former names onto the current one", () => {
    expect(withCurrentBrandName("برات چیست")).toBe("سنتو چیست");
    expect(withCurrentBrandName("برات پی")).toBe("سنتو");
    expect(withCurrentBrandName("barat pay")).toBe("cento");
    expect(withCurrentBrandName("baratpay")).toBe("cento");
  });

  it("leaves every other term alone", () => {
    expect(withCurrentBrandName("استیم")).toBe("استیم");
  });
});
