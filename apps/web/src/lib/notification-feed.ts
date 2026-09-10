import type { AccountNotification } from "@/lib/api";

/**
 * Read-state for the account bell.
 *
 * The API derives its feed from orders, refunds and support replies on every
 * request; there is no `Notification` row to flip to "read". So "read" is a
 * single timestamp held in this browser: everything newer than the marker is
 * unread, everything at or before it is not. That keeps the whole feature free
 * of a write path, at the price of read-state not following the customer to a
 * second device — which is the right trade for a bell, not for a receipt.
 */
const MARKER_KEY_PREFIX = "barat:account-notifications";

export function readMarkerStorageKey(customerCode: string): string {
  return `${MARKER_KEY_PREFIX}:${customerCode}:read-through:v1`;
}

/**
 * `null` for a browser that has never opened the bell, and equally for a stored
 * value that is no longer a date. Both mean the same thing to the caller: seed a
 * fresh marker instead of trusting it, so a corrupt entry cannot mark the whole
 * feed unread forever.
 */
export function readStoredMarker(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value !== null && Number.isFinite(Date.parse(value)) ? value : null;
  } catch {
    /* Private mode and blocked storage both throw; the in-memory marker holds. */
    return null;
  }
}

export function writeStoredMarker(key: string, marker: string): void {
  try {
    window.localStorage.setItem(key, marker);
  } catch {
    /* Same as above — losing the marker costs a badge, not correctness. */
  }
}

/**
 * How many lines arrived after the marker.
 *
 * A `null` marker counts as nothing unread: the first load seeds the marker from
 * the server's `generatedAt`, so an existing customer opening the panel for the
 * first time sees their history without a twenty-item badge over it.
 */
export function unreadCount(
  items: readonly AccountNotification[],
  marker: string | null,
): number {
  if (marker === null) return 0;
  const markerTime = Date.parse(marker);
  if (!Number.isFinite(markerTime)) return 0;
  return items.filter((item) => Date.parse(item.createdAt) > markerTime).length;
}
