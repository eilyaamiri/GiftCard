import { describe, expect, it } from "vitest";
import { clientIpHeaders } from "./client-ip";

const from = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;

describe("clientIpHeaders", () => {
  it("passes the whole X-Forwarded-For chain through untouched", () => {
    expect(clientIpHeaders(from({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }))).toEqual({
      "x-forwarded-for": "9.9.9.9, 203.0.113.7",
    });
  });

  it("falls back to X-Real-IP when there is no chain", () => {
    expect(clientIpHeaders(from({ "x-real-ip": "203.0.113.7" }))).toEqual({ "x-forwarded-for": "203.0.113.7" });
  });

  it("prefers the chain over X-Real-IP", () => {
    expect(clientIpHeaders(from({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "1.1.1.1" }))).toEqual({
      "x-forwarded-for": "203.0.113.7",
    });
  });

  it("sends nothing when the request carries no address, rather than inventing one", () => {
    expect(clientIpHeaders(from({}))).toEqual({});
    expect(clientIpHeaders(from({ "x-forwarded-for": "  ", "x-real-ip": "" }))).toEqual({});
  });
});
