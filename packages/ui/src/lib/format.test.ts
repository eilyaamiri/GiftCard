import { describe, expect, it } from "vitest";
import { formatIrr, formatJalaliDate, formatToman, formatUsd } from "./format";

describe("formatToman", () => {
  it("formats an exact Toman amount with Persian digits and separators", () => {
    expect(formatToman(1_920_000_0n)).toBe("۱,۹۲۰,۰۰۰ تومان");
  });

  it("omits the suffix when withSuffix is false", () => {
    expect(formatToman(100n, { withSuffix: false })).toBe("۱۰");
  });

  it("keeps the sign for negative amounts", () => {
    expect(formatToman(-100n)).toBe("-۱۰ تومان");
  });

  it("throws when the amount is not an exact number of Toman", () => {
    expect(() => formatToman(5n)).toThrow(RangeError);
  });

  it("throws for a non-bigint input", () => {
    // @ts-expect-error intentional runtime misuse
    expect(() => formatToman(100)).toThrow(TypeError);
  });
});

describe("formatIrr", () => {
  it("formats a Rial amount with Persian digits and separators", () => {
    expect(formatIrr(19_200_000n)).toBe("۱۹,۲۰۰,۰۰۰ ریال");
  });
});

describe("formatUsd", () => {
  it("formats a decimal string with two fraction digits", () => {
    expect(formatUsd("1234.5")).toBe("$1,234.50");
  });

  it("formats a plain integer", () => {
    expect(formatUsd("10")).toBe("$10.00");
  });
});

describe("formatJalaliDate", () => {
  it("formats an ISO date into the Jalali calendar with Persian digits", () => {
    const formatted = formatJalaliDate("2024-03-20T10:30:00.000Z", "yyyy/MM/dd");
    expect(formatted).toMatch(/^[۰-۹]{4}\/[۰-۹]{2}\/[۰-۹]{2}$/);
  });
});
