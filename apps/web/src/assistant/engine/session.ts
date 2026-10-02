import type { AssistantIdentity, AssistantSession, DataKey, SessionData } from "../types";

/**
 * What a change to one selection makes stale. Closed transitively by
 * `applyPatch`, so «region → variant → quote» needs only the direct edges.
 * A dependent is cleared before the new value is written, which is what keeps a
 * quote from outliving the choice it was priced for.
 */
export const DEPENDENTS: Readonly<Partial<Record<DataKey, readonly DataKey[]>>> = {
  serviceType: [
    "query", "product", "brand", "region", "variant", "game", "package", "gameAccountFields",
    "telegramUsername", "serviceCategory", "service", "amount", "currency", "serviceFields", "custom",
    "fieldSpecs", "fieldIndex", "quote", "orderId", "orderNumber", "paymentId", "paymentState",
  ],
  product: ["brand", "region", "variant"],
  region: ["variant"],
  variant: ["quote"],
  game: ["package", "gameAccountFields", "fieldSpecs", "fieldIndex"],
  package: ["quote"],
  gameAccountFields: ["quote"],
  telegramUsername: ["quote"],
  serviceCategory: ["service", "amount", "currency", "serviceFields", "fieldSpecs", "fieldIndex"],
  service: ["amount", "currency", "serviceFields", "fieldSpecs", "fieldIndex"],
  amount: ["quote"],
  currency: ["quote"],
  serviceFields: ["quote"],
  custom: ["quote"],
  quote: ["orderId", "orderNumber", "paymentId", "paymentState"],
};

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function dependentsOf(key: DataKey, into: Set<DataKey>): void {
  for (const dependent of DEPENDENTS[key] ?? []) {
    if (into.has(dependent)) continue;
    into.add(dependent);
    dependentsOf(dependent, into);
  }
}

/**
 * A patch value of `undefined` clears the key. Re-selecting the value a key
 * already holds invalidates nothing — only an actual change does.
 */
export function applyPatch(data: SessionData, patch: Partial<SessionData>): SessionData {
  const next: SessionData = { ...data };
  const stale = new Set<DataKey>();
  for (const key of Object.keys(patch) as DataKey[]) {
    if (!sameValue(data[key], patch[key])) dependentsOf(key, stale);
  }
  for (const key of stale) delete next[key];
  for (const key of Object.keys(patch) as DataKey[]) {
    const value = patch[key];
    if (value === undefined) delete next[key];
    else (next as Record<string, unknown>)[key] = value;
  }
  return next;
}

export const MAX_HISTORY = 40;
export const MAX_TRANSCRIPT = 80;

export function createSession(
  sessionId: string,
  identity: AssistantIdentity,
  userId: string | null,
  now: number,
): AssistantSession {
  return {
    sessionId,
    channel: identity.channel,
    channelUserId: identity.channelUserId,
    userId,
    currentFlow: "mainMenu",
    currentState: "menu",
    stateHistory: [],
    data: {},
    lastResponse: null,
    retry: null,
    transcript: [],
    updatedAt: now,
  };
}

export function snapshot(data: SessionData): SessionData {
  return JSON.parse(JSON.stringify(data)) as SessionData;
}
