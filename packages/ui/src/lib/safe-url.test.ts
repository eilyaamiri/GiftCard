import { describe, expect, it } from "vitest";
import { jsonForInlineScript, resolvedPathname, safeHttpUrl, sameOriginPath } from "./safe-url";

describe("sameOriginPath", () => {
  it.each([
    "/account",
    "/quote/clx123",
    "/gift-cards?category=steam&page=2",
    "/orders/BP-1#delivery",
    "/gift-cards/%D8%A7%D8%B3%D8%AA%DB%8C%D9%85",
    "/gift-cards/استیم",
  ])("keeps the same-origin path %s unchanged", (path) => {
    expect(sameOriginPath(path)).toBe(path);
  });

  it.each([
    ["protocol-relative", "//evil.example"],
    ["backslash", "/\\evil.example"],
    ["backslash pair", "/\\\\evil.example"],
    ["tab before the second slash", "/\t/evil.example"],
    ["newline before the second slash", "/\n/evil.example"],
    ["carriage return", "/\r/evil.example"],
    ["NUL", "/\u0000/evil.example"],
    ["absolute https", "https://evil.example/account"],
    ["javascript scheme", "javascript:alert(1)"],
    ["relative without a slash", "account"],
    ["empty", ""],
  ])("rejects a %s target", (_label, path) => {
    expect(sameOriginPath(path)).toBeNull();
  });

  it("rejects values that are not strings, and absurdly long ones", () => {
    expect(sameOriginPath(null)).toBeNull();
    expect(sameOriginPath(undefined)).toBeNull();
    expect(sameOriginPath(["/account"])).toBeNull();
    expect(sameOriginPath(`/${"a".repeat(2_048)}`)).toBeNull();
  });
});

describe("resolvedPathname", () => {
  it("normalises dot segments the way the browser will", () => {
    expect(resolvedPathname("/account/../login?x=1")).toBe("/login");
    expect(resolvedPathname("/./otp")).toBe("/otp");
  });
});

describe("safeHttpUrl", () => {
  it("keeps http and https links", () => {
    expect(safeHttpUrl("https://redeem.example.com/abc?x=1")).toBe("https://redeem.example.com/abc?x=1");
    expect(safeHttpUrl("http://shop.example/")).toBe("http://shop.example/");
  });

  it.each([
    "javascript:alert(1)",
    " javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "javascript://x/%0aalert(1)",
    "data:text/html,<script>alert(1)</script>",
    "blob:https://shop.example/uuid",
    "file:///etc/passwd",
    "vbscript:msgbox(1)",
    "/relative/path",
    "not a url",
    "",
  ])("refuses %s", (value) => {
    expect(safeHttpUrl(value)).toBeNull();
  });

  it("treats null and undefined as no link", () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe("jsonForInlineScript", () => {
  it("cannot be closed from inside a value", () => {
    const html = jsonForInlineScript({ answer: "</script><script>alert(1)</script>" });
    expect(html).not.toContain("</script>");
    expect(html).not.toContain("<");
    expect(html).not.toContain(">");
  });

  it("escapes characters that end a line in a script and HTML entities", () => {
    const html = jsonForInlineScript({ text: "a\u2028b\u2029c & <!-- d" });
    expect(html).not.toMatch(/[\u2028\u2029&<]/u);
  });

  it("round-trips to exactly the original value", () => {
    const value = [{ "@type": "Question", name: "چرا </script>?", acceptedAnswer: { text: "a & b > c\u2028" } }];
    expect(JSON.parse(jsonForInlineScript(value))).toEqual(value);
  });
});
