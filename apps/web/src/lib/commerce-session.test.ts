import { afterEach, describe, expect, it, vi } from "vitest";

import { getCommerceSessionToken } from "./commerce-session";

describe("getCommerceSessionToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reuses the opaque token already assigned to this browser", () => {
    const getItem = vi.fn(() => "existing-session-token");
    const setItem = vi.fn();
    vi.stubGlobal("window", { localStorage: { getItem, setItem } });

    expect(getCommerceSessionToken()).toBe("existing-session-token");
    expect(setItem).not.toHaveBeenCalled();
  });

  it("creates and stores a token when this browser has no session yet", () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    const randomUUID = vi.fn(() => "c7d25700-0c7d-47d6-80f1-9e2d6ba22d1b");
    vi.stubGlobal("window", { localStorage: { getItem, setItem } });
    vi.stubGlobal("crypto", { randomUUID });

    expect(getCommerceSessionToken()).toBe("c7d257000c7d47d680f19e2d6ba22d1b");
    expect(setItem).toHaveBeenCalledWith("barat_commerce_session", "c7d257000c7d47d680f19e2d6ba22d1b");
  });

  it("refuses to mint a customer session during server rendering", () => {
    vi.stubGlobal("window", undefined);

    expect(() => getCommerceSessionToken()).toThrow("can only run in the browser");
  });
});
