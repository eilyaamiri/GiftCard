import { describe, expect, it } from "vitest";
import { formatIrr, formatJalaliDate, formatToman, formatTomanCompact, formatUsd } from "./format";

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

/**
 * A compact price label may never change the amount: every case here is either
 * exactly expressible in the compact unit or falls back to the full digits.
 */
describe("formatTomanCompact", () => {
  it("says whole thousands in words", () => {
    // ۱۰ هزار تومان = 100,000 IRR — the card label the design asks for.
    expect(formatTomanCompact(100_000n)).toBe("۱۰ هزار تومان");
    expect(formatTomanCompact(4_500_000n)).toBe("۴۵۰ هزار تومان");
  });

  it("says millions with at most one exact decimal", () => {
    expect(formatTomanCompact(25_000_000n)).toBe("۲٫۵ میلیون تومان");
    expect(formatTomanCompact(120_000_000n)).toBe("۱۲ میلیون تومان");
  });

  it("falls back to full digits rather than rounding", () => {
    // 2,450,000 Toman is not a whole tenth of a million.
    expect(formatTomanCompact(24_500_000n)).toBe("۲,۴۵۰,۰۰۰ تومان");
    // 10,500 Toman is not a whole thousand either.
    expect(formatTomanCompact(105_000n)).toBe("۱۰,۵۰۰ تومان");
  });

  it("keeps sub-thousand and negative amounts on the full formatter", () => {
    expect(formatTomanCompact(9_990n)).toBe("۹۹۹ تومان");
    expect(formatTomanCompact(-100_000n)).toBe("-۱۰,۰۰۰ تومان");
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
