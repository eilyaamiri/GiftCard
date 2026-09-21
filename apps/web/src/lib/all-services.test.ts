import { describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ api: { services: vi.fn() } }));
import { api } from "./api";
import { listAllServices } from "./all-services";

describe("complete service listing", () => {
  it("includes later API pages so service detail routes do not disappear after entry 20", async () => {
    const service = { id: "late-service", slug: "late-service", name: "Late service", nameFa: "خدمت", category: "travel", currency: "USD", minAmount: null, maxAmount: null, isActive: true, requiresManualReview: true, fields: [] };
    vi.mocked(api.services).mockResolvedValueOnce({ items: [], meta: { page: 1, pageSize: 100, total: 101, totalPages: 2 } });
    vi.mocked(api.services).mockResolvedValueOnce({ items: [service], meta: { page: 2, pageSize: 100, total: 101, totalPages: 2 } });
    await expect(listAllServices()).resolves.toEqual([service]);
    expect(api.services).toHaveBeenNthCalledWith(1, 1, 100);
    expect(api.services).toHaveBeenNthCalledWith(2, 2, 100);
  });
});
