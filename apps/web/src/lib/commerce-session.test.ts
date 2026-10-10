import { afterEach, describe, expect, it, vi } from "vitest";

import { getCommerceSessionToken, peekCommerceSessionToken } from "./commerce-session";

/** The browser surface the module touches: storage, cookie jar, protocol. */
function stubBrowser(options: { readonly stored?: string | null; readonly protocol?: string } = {}) {
  const getItem = vi.fn(() => options.stored ?? null);
  const setItem = vi.fn();
  const documentStub: { cookie: string } = { cookie: "" };
  vi.stubGlobal("window", { localStorage: { getItem, setItem }, location: { protocol: options.protocol ?? "https:" } });
  vi.stubGlobal("document", documentStub);
  return { getItem, setItem, documentStub };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCommerceSessionToken", () => {
  it("reuses the opaque token already assigned to this browser", () => {
    const { setItem, documentStub } = stubBrowser({ stored: "existing-session-token" });

    expect(getCommerceSessionToken()).toBe("existing-session-token");
    expect(setItem).not.toHaveBeenCalled();
    /* Mirrored on every call, so a browser that predates the cookie catches up. */
    expect(documentStub.cookie).toContain("barat_commerce_session=existing-session-token");
    expect(documentStub.cookie).toContain("samesite=lax");
    expect(documentStub.cookie).toContain("secure");
  });

  it("creates and stores a token when this browser has no session yet", () => {
    const { setItem, documentStub } = stubBrowser();
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "c7d25700-0c7d-47d6-80f1-9e2d6ba22d1b") });

    expect(getCommerceSessionToken()).toBe("c7d257000c7d47d680f19e2d6ba22d1b");
    expect(setItem).toHaveBeenCalledWith("barat_commerce_session", "c7d257000c7d47d680f19e2d6ba22d1b");
    expect(documentStub.cookie).toContain("barat_commerce_session=c7d257000c7d47d680f19e2d6ba22d1b");
  });

  it("replaces a stored value that could not be a token before it reaches a cookie or header", () => {
    /* `;` would terminate the cookie attribute list — whatever put it there,
     * it is not one of our tokens and must not travel. */
    const { setItem } = stubBrowser({ stored: "bad;token" });
    vi.stubGlobal("crypto", { randomUUID: vi.fn(() => "c7d25700-0c7d-47d6-80f1-9e2d6ba22d1b") });

    expect(getCommerceSessionToken()).toBe("c7d257000c7d47d680f19e2d6ba22d1b");
    expect(setItem).toHaveBeenCalledWith("barat_commerce_session", "c7d257000c7d47d680f19e2d6ba22d1b");
  });

  it("omits the secure attribute for plain-http development", () => {
    const { documentStub } = stubBrowser({ stored: "existing-session-token", protocol: "http:" });

    getCommerceSessionToken();
    expect(documentStub.cookie).not.toContain("secure");
  });

  it("refuses to mint a customer session during server rendering", () => {
    vi.stubGlobal("window", undefined);

    expect(() => getCommerceSessionToken()).toThrow("can only run in the browser");
  });
});

describe("peekCommerceSessionToken", () => {
  it("returns the existing token and re-mirrors the cookie", () => {
    const { documentStub } = stubBrowser({ stored: "existing-session-token" });

    expect(peekCommerceSessionToken()).toBe("existing-session-token");
    expect(documentStub.cookie).toContain("barat_commerce_session=existing-session-token");
  });

  it("never mints: a browser that has not quoted has nothing to adopt", () => {
    const { setItem, documentStub } = stubBrowser();

    expect(peekCommerceSessionToken()).toBeNull();
    expect(setItem).not.toHaveBeenCalled();
    expect(documentStub.cookie).toBe("");
  });

  it("is null during server rendering rather than throwing", () => {
    vi.stubGlobal("window", undefined);

    expect(peekCommerceSessionToken()).toBeNull();
  });
});
