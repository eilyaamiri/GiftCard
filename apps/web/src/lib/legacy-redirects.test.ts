import { describe, expect, it } from "vitest";
import { LEGACY_REDIRECTS } from "./legacy-redirects";

describe("LEGACY_REDIRECTS", () => {
  it("is permanent and lands on the final URL in one hop", () => {
    const sources = new Set(LEGACY_REDIRECTS.map((entry) => entry.source));
    for (const entry of LEGACY_REDIRECTS) {
      expect(entry.permanent).toBe(true);
      expect(sources.has(entry.destination)).toBe(false);
      expect(entry.destination).not.toBe(entry.source);
    }
  });

  it("never sends anyone to a URL that still carries the old name", () => {
    for (const entry of LEGACY_REDIRECTS) expect(entry.destination).not.toMatch(/barat/iu);
  });

  it("has one entry per retired path", () => {
    expect(new Set(LEGACY_REDIRECTS.map((entry) => entry.source)).size).toBe(LEGACY_REDIRECTS.length);
  });
});
