import { describe, expect, it } from "vitest";
import { isSteamEntry, isValidSteamLogin, normalizeSteamLogin, parseSteamUsdAmount, pickSteamTemplateOffer } from "./steam";

const offer = (over: Record<string, unknown>) => ({ id: "o", name: "x", ...over }) as Parameters<typeof pickSteamTemplateOffer>[0][number];

describe("isSteamEntry", () => {
  it("matches the Steam wallet by slug, name, brand or Persian name", () => {
    expect(isSteamEntry({ slug: "steam-wallet" })).toBe(true);
    expect(isSteamEntry({ slug: "x", brandName: "Steam" })).toBe(true);
    expect(isSteamEntry({ slug: "x", nameFa: "شارژ استیم" })).toBe(true);
  });

  it("does not match games that merely contain the letters", () => {
    expect(isSteamEntry({ slug: "pubg-mobile-uc", name: "PUBG Mobile UC" })).toBe(false);
    expect(isSteamEntry({ slug: "steampunk-saga", name: "Steampunk Saga" })).toBe(false);
  });
});

describe("parseSteamUsdAmount", () => {
  it("accepts whole and two-decimal amounts and canonicalises them", () => {
    expect(parseSteamUsdAmount("5")).toEqual({ ok: true, amount: "5" });
    expect(parseSteamUsdAmount(" 10.50 ")).toEqual({ ok: true, amount: "10.5" });
    expect(parseSteamUsdAmount("0.15")).toEqual({ ok: true, amount: "0.15" });
    expect(parseSteamUsdAmount("1000")).toEqual({ ok: true, amount: "1000" });
    expect(parseSteamUsdAmount("۲۵٫۵")).toEqual({ ok: true, amount: "25.5" });
  });

  it("refuses empty, malformed, too-precise and out-of-range amounts", () => {
    expect(parseSteamUsdAmount("  ")).toEqual({ ok: false, reason: "REQUIRED" });
    expect(parseSteamUsdAmount("abc")).toEqual({ ok: false, reason: "FORMAT" });
    expect(parseSteamUsdAmount("1.234")).toEqual({ ok: false, reason: "FORMAT" });
    expect(parseSteamUsdAmount("-5")).toEqual({ ok: false, reason: "FORMAT" });
    expect(parseSteamUsdAmount("0.14")).toEqual({ ok: false, reason: "BELOW_MIN" });
    expect(parseSteamUsdAmount("0")).toEqual({ ok: false, reason: "BELOW_MIN" });
    expect(parseSteamUsdAmount("1000.01")).toEqual({ ok: false, reason: "ABOVE_MAX" });
  });
});

describe("pickSteamTemplateOffer", () => {
  it("prefers the :custom SKU, else the only buyable offer", () => {
    expect(pickSteamTemplateOffer([offer({ id: "a", providerSku: "steam:usd:5" }), offer({ id: "b", providerSku: "steam:usd:custom" })])?.id).toBe("b");
    expect(pickSteamTemplateOffer([offer({ id: "only" })])?.id).toBe("only");
    expect(pickSteamTemplateOffer([offer({ id: "x", isAvailable: false })])).toBeUndefined();
    expect(pickSteamTemplateOffer([offer({ id: "x" }), offer({ id: "y" })])).toBeUndefined();
  });
});

describe("login handling", () => {
  it("accepts a plain login and rejects blanks and spaces", () => {
    expect(isValidSteamLogin("gabe_n")).toBe(true);
    expect(isValidSteamLogin("  ")).toBe(false);
    expect(isValidSteamLogin("two words")).toBe(false);
    expect(normalizeSteamLogin("  user۱۲  ")).toBe("user12");
  });
});
