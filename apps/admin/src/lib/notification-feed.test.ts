import { describe, expect, it, vi } from "vitest";

import type { StaffNotification } from "./api";
import {
  readMarkerStorageKey,
  readStoredMarker,
  unreadCount,
  writeStoredMarker,
} from "./notification-feed";

function line(createdAt: string, id = createdAt): StaffNotification {
  return {
    id,
    kind: "TASK_ASSIGNED",
    title: "تسک به شما ارجاع شد",
    body: null,
    href: null,
    createdAt,
  };
}

function withStorage(storage: Partial<Storage>): () => void {
  const original = globalThis.window;
  vi.stubGlobal("window", { localStorage: storage as Storage });
  return () => {
    if (original === undefined) vi.unstubAllGlobals();
    else vi.stubGlobal("window", original);
  };
}

describe("readMarkerStorageKey", () => {
  /* Operators share workstations; one staff member's badge must not follow the
   * next person who signs in on the same browser. */
  it("keys the marker by staff id", () => {
    expect(readMarkerStorageKey("staff-1")).not.toBe(readMarkerStorageKey("staff-2"));
  });
});

describe("readStoredMarker", () => {
  it("returns a stored timestamp unchanged", () => {
    const restore = withStorage({ getItem: () => "2026-09-10T12:00:00.000Z" });

    expect(readStoredMarker("key")).toBe("2026-09-10T12:00:00.000Z");

    restore();
  });

  it("treats a value that is not a date as no marker at all", () => {
    const restore = withStorage({ getItem: () => "" });

    expect(readStoredMarker("key")).toBeNull();

    restore();
  });

  it("survives storage being blocked outright", () => {
    const restore = withStorage({
      getItem: () => {
        throw new Error("access denied");
      },
    });

    expect(readStoredMarker("key")).toBeNull();

    restore();
  });
});

describe("writeStoredMarker", () => {
  it("swallows a storage failure rather than breaking the shell", () => {
    const restore = withStorage({
      setItem: () => {
        throw new Error("quota exceeded");
      },
    });

    expect(() => writeStoredMarker("key", "2026-09-10T12:00:00.000Z")).not.toThrow();

    restore();
  });
});

describe("unreadCount", () => {
  const items = [
    line("2026-09-10T12:00:00.000Z"),
    line("2026-09-10T11:00:00.000Z"),
    line("2026-09-10T10:00:00.000Z"),
  ];

  it("counts only what arrived after the marker", () => {
    expect(unreadCount(items, "2026-09-10T10:30:00.000Z")).toBe(2);
  });

  it("counts nothing when the marker is at the newest line", () => {
    expect(unreadCount(items, "2026-09-10T12:00:00.000Z")).toBe(0);
  });

  it("counts nothing for a browser that has no marker yet", () => {
    expect(unreadCount(items, null)).toBe(0);
  });

  it("counts nothing rather than everything when the marker is unreadable", () => {
    expect(unreadCount(items, "not-a-date")).toBe(0);
  });
});
