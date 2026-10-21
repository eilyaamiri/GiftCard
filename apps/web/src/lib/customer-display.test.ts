import type { CustomerDto } from "@barat/contracts";
import { describe, expect, it } from "vitest";
import { customerDisplayName, formatMaskedMobile } from "./customer-display";

describe("formatMaskedMobile", () => {
  it("writes the API mask as a local 09 number in Persian digits", () => {
    expect(formatMaskedMobile("+9891***4567")).toBe("۰۹۱****۴۵۶۷");
  });

  it("keeps the eleven-character shape of a real mobile", () => {
    expect([...formatMaskedMobile("+9891***4567")]).toHaveLength(11);
    expect(formatMaskedMobile("+98912***4567")).toBe("۰۹۱۲***۴۵۶۷");
  });

  it("leaves anything that is not a masked +98 mobile untouched", () => {
    expect(formatMaskedMobile("a***@example.com")).toBe("a***@example.com");
    expect(formatMaskedMobile("+4479***1234")).toBe("+4479***1234");
  });
});

describe("customerDisplayName", () => {
  const base = {
    firstName: null,
    lastName: null,
    maskedMobile: "+9891***4567",
    maskedEmail: null,
    customerCode: "CUS-ABC123",
  } as unknown as CustomerDto;

  it("prefers the customer's name once the profile is filled in", () => {
    expect(customerDisplayName({ ...base, firstName: "سارا", lastName: "رضایی" })).toBe("سارا رضایی");
  });

  it("falls back to the formatted mobile on first login", () => {
    expect(customerDisplayName(base)).toBe("۰۹۱****۴۵۶۷");
  });

  it("falls back to e-mail, then customer code, when there is no mobile", () => {
    expect(customerDisplayName({ ...base, maskedMobile: null, maskedEmail: "a***@example.com" })).toBe("a***@example.com");
    expect(customerDisplayName({ ...base, maskedMobile: null })).toBe("CUS-ABC123");
  });
});
