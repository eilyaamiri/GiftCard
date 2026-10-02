/**
 * Funnel analytics for the web channel.
 *
 * There is no analytics endpoint yet, so an event is a browser `CustomEvent`
 * that a collector can subscribe to without the assistant changing. Only a short
 * allowlist of metadata is forwarded: anything else — a query, an account id, a
 * username, an amount — never leaves the engine.
 */

export const ASSISTANT_EVENT = "barat:assistant";

const SAFE_KEYS = new Set(["flow", "state", "service", "channel", "action", "outcome", "step"]);

export type SafeProps = Readonly<Record<string, string | number | boolean>>;

export function safeProps(props: SafeProps): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(props)) {
    if (!SAFE_KEYS.has(key)) continue;
    result[key] = typeof value === "string" ? value.slice(0, 64) : value;
  }
  return result;
}

export function trackAssistantEvent(event: string, props: SafeProps): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ASSISTANT_EVENT, { detail: { event, props: safeProps(props), at: Date.now() } }));
}
