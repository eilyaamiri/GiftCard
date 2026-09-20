import { describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("./api", () => ({ api: { get: (...args: unknown[]) => get(...args) } }));

const { getSupportChannels } = await import("./support-channels");

const PHONE = {
  kind: "PHONE",
  title: "تماس تلفنی",
  description: "شنبه تا چهارشنبه، ۹ تا ۱۷",
  href: "tel:02191001234",
  isExternal: false,
  requiresAuth: false,
} as const;

/*
 * Each test sets its own implementation, and there is deliberately no
 * `mockReset` between them: resetting the mock makes vitest forget the rejected
 * promise it recorded for a call, which then surfaces as an unhandled error and
 * fails the test the `catch` below was written to prove.
 */
describe("getSupportChannels", () => {
  it("reads the published channels from the API", async () => {
    get.mockImplementation(async () => ({ items: [PHONE] }));

    await expect(getSupportChannels()).resolves.toEqual([PHONE]);
    expect(get).toHaveBeenCalledWith("/api/support/channels", expect.anything());
  });

  it("falls back to no channels rather than taking the page down with it", async () => {
    /* This runs in the root layout, so a throw here would blank every page on
     * the storefront over a list of phone numbers. */
    get.mockImplementation(async () => {
      throw new Error("service unavailable");
    });

    await expect(getSupportChannels()).resolves.toEqual([]);
  });

  it("treats a response it does not recognise as no channels at all", async () => {
    get.mockImplementation(async (_path: string, schema: { parse: (value: unknown) => unknown }) =>
      schema.parse({ items: [{ ...PHONE, kind: "CARRIER_PIGEON" }] }),
    );

    await expect(getSupportChannels()).resolves.toEqual([]);
  });
});
