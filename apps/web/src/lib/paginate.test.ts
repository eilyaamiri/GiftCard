import { describe, expect, it, vi } from "vitest";

import { fetchAllPages } from "./paginate";

const page = (items: readonly number[], totalPages: number) => ({ items, meta: { totalPages } });

describe("fetchAllPages", () => {
  it("concatenates every page in order and stops at totalPages", async () => {
    const fetchPage = vi.fn(async (n: number) => page([n * 10, n * 10 + 1], 3));
    expect(await fetchAllPages(fetchPage)).toEqual([10, 11, 20, 21, 30, 31]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("makes one request for a single page", async () => {
    const fetchPage = vi.fn(async () => page([1], 1));
    expect(await fetchAllPages(fetchPage)).toEqual([1]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when there is nothing, even if totalPages is wrong", async () => {
    const fetchPage = vi.fn(async () => page([], 5));
    expect(await fetchAllPages(fetchPage)).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("never exceeds maxPages when the server keeps claiming more", async () => {
    const fetchPage = vi.fn(async () => page([1], 1_000));
    expect(await fetchAllPages(fetchPage, 4)).toHaveLength(4);
    expect(fetchPage).toHaveBeenCalledTimes(4);
  });

  it("propagates a failure so the caller decides how soft to be", async () => {
    const fetchPage = vi.fn(async (n: number) => {
      if (n === 2) throw new Error("boom");
      return page([n], 3);
    });
    await expect(fetchAllPages(fetchPage)).rejects.toThrow("boom");
  });
});
