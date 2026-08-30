import { describe, expect, it } from "vitest";
import { toLatinDigits, toPersianDigits } from "./digits";

describe("toPersianDigits", () => {
  it("converts Latin digits to Persian", () => {
    expect(toPersianDigits("1234567890")).toBe("۱۲۳۴۵۶۷۸۹۰");
  });

  it("leaves non-digit characters untouched", () => {
    expect(toPersianDigits("Order #42")).toBe("Order #۴۲");
  });

  it("accepts bigint input", () => {
    expect(toPersianDigits(42n)).toBe("۴۲");
  });
});

describe("toLatinDigits", () => {
  it("converts Persian digits to Latin", () => {
    expect(toLatinDigits("۱۲۳۴۵۶۷۸۹۰")).toBe("1234567890");
  });

  it("round-trips with toPersianDigits", () => {
    const original = "402190";
    expect(toLatinDigits(toPersianDigits(original))).toBe(original);
  });
});
