import { describe, expect, it } from "vitest";
import { brandAccent, brandInitials } from "./brand-mark";

describe("brandInitials", () => {
  it("takes one letter from each of the first two words", () => {
    expect(brandInitials("Free Fire")).toBe("FF");
    expect(brandInitials("Razer Gold")).toBe("RG");
  });

  it("takes the first two letters of a single-word name", () => {
    expect(brandInitials("Steam")).toBe("ST");
    expect(brandInitials("Netflix")).toBe("NE");
  });

  it("ignores punctuation when splitting into words", () => {
    expect(brandInitials("H&M")).toBe("HM");
    expect(brandInitials("McDonald's")).toBe("MC");
  });

  it("falls back to a question mark when nothing letter-like is left", () => {
    expect(brandInitials("***")).toBe("?");
  });
});

describe("brandAccent", () => {
  it("is stable for the same key", () => {
    expect(brandAccent("steam")).toEqual(brandAccent("steam"));
  });

  it("spreads different keys across the palette", () => {
    const colors = new Set(
      ["steam", "netflix", "apple", "walmart", "adidas", "nike", "ikea", "zara"].map(
        (key) => brandAccent(key).base + brandAccent(key).accent,
      ),
    );
    expect(colors.size).toBeGreaterThan(1);
  });
});
