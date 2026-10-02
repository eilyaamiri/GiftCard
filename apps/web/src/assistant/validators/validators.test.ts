import { describe, expect, it } from "vitest";
import { checkAmount, checkSearch, checkText, checkUrl, isCredentialField, isCurrencyCode } from "./index";

describe("checkSearch", () => {
  it("trims and collapses whitespace", () => expect(checkSearch("  i   tunes ")).toEqual({ value: "i tunes" }));
  it("rejects too short and too long", () => {
    expect(checkSearch("a")).toHaveProperty("error");
    expect(checkSearch("x".repeat(81))).toHaveProperty("error");
  });
});

describe("checkText", () => {
  it("enforces bounds", () => {
    expect(checkText("ab", 3, 10, "موضوع")).toHaveProperty("error");
    expect(checkText("abcdefghijk", 3, 10, "موضوع")).toHaveProperty("error");
    expect(checkText(" abc ", 3, 10, "موضوع")).toEqual({ value: "abc" });
  });
});

describe("checkUrl", () => {
  it("accepts http(s) only", () => {
    expect(checkUrl("https://a.example/x")).toEqual({ value: "https://a.example/x" });
    expect(checkUrl("javascript:alert(1)")).toHaveProperty("error");
    expect(checkUrl("ftp://a.example")).toHaveProperty("error");
    expect(checkUrl("not a url")).toHaveProperty("error");
  });
});

describe("checkAmount", () => {
  const b = { currency: "USD", min: "5", max: "100" };
  it("normalises Persian digits and compares exactly", () => {
    expect(checkAmount("۲۵٫۵", b)).toEqual({ value: "25.5" });
    expect(checkAmount("5", b)).toEqual({ value: "5" });
    expect(checkAmount("100", b)).toEqual({ value: "100" });
    expect(checkAmount("4.999999", b)).toHaveProperty("error");
    expect(checkAmount("100.000001", b)).toHaveProperty("error");
  });
  it("rejects zero, negatives, junk and excess precision", () => {
    for (const bad of ["0", "-5", "abc", "1e3", "1.1234567", "", "1,5"]) {
      expect(checkAmount(bad, { currency: "USD" })).toHaveProperty("error");
    }
  });
  it("has no upper bound when none is declared", () => {
    expect(checkAmount("999999999", { currency: "USD", min: null, max: null })).toEqual({ value: "999999999" });
  });
});

describe("isCurrencyCode", () => {
  it("is three capital letters", () => {
    expect(isCurrencyCode("USD")).toBe(true);
    expect(isCurrencyCode("usd")).toBe(false);
    expect(isCurrencyCode("US")).toBe(false);
  });
});

describe("isCredentialField", () => {
  it("flags secrets by key, label or kind", () => {
    expect(isCredentialField({ key: "accountPassword" })).toBe(true);
    expect(isCredentialField({ key: "x", label: "رمز عبور" })).toBe(true);
    expect(isCredentialField({ key: "login_code" })).toBe(true);
    expect(isCredentialField({ key: "x", kind: "password" })).toBe(true);
    expect(isCredentialField({ key: "otp" })).toBe(true);
  });
  it("lets ordinary fields through", () => {
    expect(isCredentialField({ key: "player_id", label: "شناسه بازیکن" })).toBe(false);
    expect(isCredentialField({ key: "accountEmail", label: "ایمیل حساب" })).toBe(false);
    expect(isCredentialField({ key: "invoiceReference" })).toBe(false);
  });
});
