import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REGION_NAMES, regionDisplay, regionName, regionOptions } from "./regions";

/** The storefront's table, read as text: an app does not import another. */
function storefrontNames(): Record<string, string> {
  const source = readFileSync(path.resolve(process.cwd(), "../web/src/lib/regions.ts"), "utf8");
  const block = /const NAMES[^{]*\{([\s\S]*?)\n\};/u.exec(source)?.[1] ?? "";
  const names: Record<string, string> = {};
  for (const match of block.matchAll(/^\s+([A-Z]+): "([^"]+)",$/gmu)) names[match[1] ?? ""] = match[2] ?? "";
  return names;
}

describe("region names", () => {
  it("name every region the storefront names, the same way", () => {
    const web = storefrontNames();

    // Guards the parse above: a changed layout there must not turn this into a pass over nothing.
    expect(Object.keys(web).length).toBeGreaterThan(200);
    for (const [code, name] of Object.entries(web)) expect(REGION_NAMES[code], code).toBe(name);
  });

  it("add only CIS to the storefront's list", () => {
    const web = storefrontNames();

    expect(Object.keys(REGION_NAMES).filter((code) => web[code] === undefined)).toEqual(["CIS"]);
  });

  it("look a region up in any case, and say nothing for one it does not know", () => {
    expect(regionName("us")).toBe("آمریکا");
    expect(regionName(" TR ")).toBe("ترکیه");
    expect(regionName("ROBUX")).toBeNull();
    expect(regionName("")).toBeNull();
    expect(regionName(null)).toBeNull();
  });

  it("show a known region with its code, and an unknown one as it is", () => {
    expect(regionDisplay("us")).toBe("آمریکا (US)");
    expect(regionDisplay("ROBUX")).toBe("ROBUX");
  });
});

describe("regionOptions", () => {
  const options = regionOptions();
  const codes = options.map((option) => option.code);

  it("offers each region once: no alias beside the code it stands for", () => {
    expect(new Set(codes).size).toBe(codes.length);
    for (const alias of ["UK", "USA", "WW", "TURKEY", "EUROPE"]) expect(codes).not.toContain(alias);
    for (const code of ["GB", "US", "TR", "GLOBAL", "EU", "CIS"]) expect(codes).toContain(code);
  });

  it("is in Persian alphabetical order", () => {
    const collator = new Intl.Collator("fa");
    const names = options.map((option) => option.name);

    expect(names).toEqual([...names].sort((a, b) => collator.compare(a, b)));
  });

  it("only offers codes the API accepts as a region", () => {
    for (const code of codes) expect(code).toMatch(/^[A-Z]{2,8}$/u);
  });
});
