import { describe, expect, it } from "vitest";
import { safeNextPath } from "./otp-challenge";

describe("safeNextPath", () => {
  it("keeps the page the customer was sent to log in from", () => {
    expect(safeNextPath("/quote/clx123")).toBe("/quote/clx123");
    expect(safeNextPath("/account/orders?page=2")).toBe("/account/orders?page=2");
  });

  it("falls back when there is no next", () => {
    expect(safeNextPath(null)).toBe("/account");
    expect(safeNextPath(undefined)).toBe("/account");
    expect(safeNextPath("")).toBe("/account");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    "https://evil.example",
    "javascript:alert(1)",
  ])("refuses the off-site target %j", (next) => {
    expect(safeNextPath(next)).toBe("/account");
  });

  it("does not loop back into the sign-in flow, however the path is spelled", () => {
    expect(safeNextPath("/login")).toBe("/account");
    expect(safeNextPath("/otp?x=1")).toBe("/account");
    expect(safeNextPath("/account/../login")).toBe("/account");
  });

  it("honours a caller-supplied fallback", () => {
    expect(safeNextPath("/\\evil.example", "/")).toBe("/");
  });
});
