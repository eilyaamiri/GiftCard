import type { AssistantSession } from "../types";

/**
 * Where sessions live between requests. The engine never reaches for storage
 * directly, so a Telegram worker can plug in a database store unchanged.
 */
export interface SessionStore {
  get(sessionId: string): Promise<AssistantSession | null>;
  set(session: AssistantSession): Promise<void>;
  delete(sessionId: string): Promise<void>;
}

export function createMemoryStore(): SessionStore {
  const sessions = new Map<string, string>();
  return {
    get: async (id) => {
      const raw = sessions.get(id);
      return raw === undefined ? null : (JSON.parse(raw) as AssistantSession);
    },
    set: async (session) => {
      sessions.set(session.sessionId, JSON.stringify(session));
    },
    delete: async (id) => {
      sessions.delete(id);
    },
  };
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const PREFIX = "barat.assistant.";

/**
 * Browser tab storage. A session holds ids, labels and the person's own
 * non-secret answers (a Telegram handle, a player id); passwords, OTPs and
 * payment credentials are never collected, so none can land here. sessionStorage
 * rather than localStorage: it dies with the tab.
 */
export function createBrowserStore(storage: StorageLike | null): SessionStore {
  const fallback = createMemoryStore();
  if (storage === null) return fallback;
  return {
    get: async (id) => {
      try {
        const raw = storage.getItem(PREFIX + id);
        if (raw !== null) {
          const parsed = JSON.parse(raw) as AssistantSession;
          return parsed.sessionId === id ? parsed : null;
        }
      } catch {
        /* unreadable storage: fall through to what memory holds */
      }
      return fallback.get(id);
    },
    set: async (session) => {
      try {
        storage.setItem(PREFIX + session.sessionId, JSON.stringify(session));
      } catch {
        await fallback.set(session);
      }
    },
    delete: async (id) => {
      try {
        storage.removeItem(PREFIX + id);
      } catch {
        /* nothing to clean */
      }
      await fallback.delete(id);
    },
  };
}
