import { describe, expect, it } from "vitest";
import { DESK_STATUSES, TERMINAL_STATUSES, newestFirst } from "./work-items";

describe("DESK_STATUSES", () => {
  it("is every status that holds one of the operator's slots, waiting ones included", () => {
    expect([...DESK_STATUSES].sort()).toEqual(
      ["ASSIGNED", "IN_PROGRESS", "NEED_REVIEW", "WAITING_CUSTOMER", "WAITING_SUPPLIER"].sort(),
    );
  });

  it("never includes a finished or unclaimed task", () => {
    for (const status of [...TERMINAL_STATUSES, "UNASSIGNED"]) {
      expect(DESK_STATUSES).not.toContain(status);
    }
  });
});

describe("newestFirst", () => {
  it("puts the most recently created task at the top", () => {
    const items = [
      { id: "old", createdAt: "2026-11-01T08:00:00.000Z" },
      { id: "new", createdAt: "2026-11-03T08:00:00.000Z" },
      { id: "mid", createdAt: "2026-11-02T08:00:00.000Z" },
    ];
    expect(newestFirst(items).map((item) => item.id)).toEqual(["new", "mid", "old"]);
  });

  it("does not reorder the list it was given", () => {
    const items = [
      { id: "a", createdAt: "2026-11-01T08:00:00.000Z" },
      { id: "b", createdAt: "2026-11-02T08:00:00.000Z" },
    ];
    newestFirst(items);
    expect(items.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("keeps the order it was given for tasks created at the same moment", () => {
    const at = "2026-11-02T08:00:00.000Z";
    const items = [
      { id: "first", createdAt: at },
      { id: "second", createdAt: at },
    ];
    expect(newestFirst(items).map((item) => item.id)).toEqual(["first", "second"]);
  });
});
