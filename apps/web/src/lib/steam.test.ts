import { describe, expect, it } from "vitest";
import { formatUsd, isSteamEntry, isValidSteamLogin, normalizeSteamLogin, offerUsd } from "./steam";

const offer = (over: Record<string, unknown>) => ({ id: "o", name: "x", ...over }) as Parameters<typeof offerUsd>[0];

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

describe("offerUsd", () => {
  it("prefers the face value, then the SKU tail, then the name", () => {
    expect(offerUsd(offer({ faceValue: "25.0000", providerSku: "steam:usd:5" }))).toBe(25);
    expect(offerUsd(offer({ providerSku: "steam:usd:10.5" }))).toBe(10.5);
    expect(offerUsd(offer({ name: "Steam Wallet $50" }))).toBe(50);
    expect(offerUsd(offer({ name: "۱۰۰ دلار اعتبار استیم" }))).toBe(100);
  });

  it("returns null when no amount can be read", () => {
    expect(offerUsd(offer({ name: "Steam Wallet" }))).toBeNull();
  });
});

describe("login handling", () => {
  it("accepts a plain login and rejects blanks and spaces", () => {
    expect(isValidSteamLogin("gabe_n")).toBe(true);
    expect(isValidSteamLogin("  ")).toBe(false);
    expect(isValidSteamLogin("two words")).toBe(false);
    expect(normalizeSteamLogin("  user۱۲  ")).toBe("user12");
  });

  it("formats USD without float noise", () => {
    expect(formatUsd(5)).toBe("$5");
    expect(formatUsd(10.5)).toBe("$10.50");
  });
});
