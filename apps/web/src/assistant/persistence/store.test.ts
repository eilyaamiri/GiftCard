import { describe, expect, it } from "vitest";
import { createSession } from "../engine/session";
import { createBrowserStore, createMemoryStore } from "./store";

const session = (id: string) => createSession(id, { channel: "web", channelUserId: "u1" }, null, 1);

function fakeStorage(failWrites = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("quota");
      data.set(key, value);
    },
    removeItem: (key: string) => void data.delete(key),
  };
}

describe("memory store", () => {
  it("round-trips a copy, not a shared reference", async () => {
    const store = createMemoryStore();
    const s = session("a");
    await store.set(s);
    const read = await store.get("a");
    expect(read).toEqual(s);
    expect(read).not.toBe(s);
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
  });
});

describe("browser store", () => {
  it("namespaces keys and round-trips", async () => {
    const storage = fakeStorage();
    const store = createBrowserStore(storage);
    await store.set(session("a"));
    expect([...storage.data.keys()]).toEqual(["barat.assistant.a"]);
    expect((await store.get("a"))?.sessionId).toBe("a");
  });

  it("returns null for a missing, corrupt or mismatched record", async () => {
    const storage = fakeStorage();
    const store = createBrowserStore(storage);
    expect(await store.get("missing")).toBeNull();
    storage.data.set("barat.assistant.bad", "{not json");
    expect(await store.get("bad")).toBeNull();
    storage.data.set("barat.assistant.x", JSON.stringify(session("other")));
    expect(await store.get("x")).toBeNull();
  });

  it("keeps working in memory when storage rejects writes", async () => {
    const store = createBrowserStore(fakeStorage(true));
    await store.set(session("a"));
    expect((await store.get("a"))?.sessionId).toBe("a");
    await store.delete("a");
    expect(await store.get("a")).toBeNull();
  });

  it("falls back to memory without any storage", async () => {
    const store = createBrowserStore(null);
    await store.set(session("a"));
    expect((await store.get("a"))?.sessionId).toBe("a");
  });

  it("delete clears storage", async () => {
    const storage = fakeStorage();
    const store = createBrowserStore(storage);
    await store.set(session("a"));
    await store.delete("a");
    expect(storage.data.size).toBe(0);
  });
});
