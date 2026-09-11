import { describe, expect, it } from "vitest";

import { formatIrrStringAsExactToman } from "./format-bps";

describe("formatIrrStringAsExactToman", () => {
  it("keeps every Rial while displaying the amount in Toman", () => {
    expect(formatIrrStringAsExactToman("329218895")).toBe("۳۲,۹۲۱,۸۸۹٫۵ تومان");
    expect(formatIrrStringAsExactToman("10496400000")).toBe("۱,۰۴۹,۶۴۰,۰۰۰ تومان");
  });

  it("preserves signs and can omit the unit suffix", () => {
    expect(formatIrrStringAsExactToman("-15", { withSuffix: false })).toBe("-۱٫۵");
  });
});
