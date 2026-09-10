import type { StaffNotification } from "@/lib/api";

/**
 * Read-state for the staff bell.
 *
 * `/api/staff/notifications` derives its feed from work items, queues and ticket
 * replies on every request; nothing is stored per notification, so there is no
 * row to mark read. "Read" is one timestamp per staff member in this browser:
 * anything newer than the marker is unread. Keyed by staff id so a shared
 * workstation does not hand one operator another's badge.
 */
const MARKER_KEY_PREFIX = "barat:staff-notifications";

export function readMarkerStorageKey(staffId: string): string {
  return `${MARKER_KEY_PREFIX}:${staffId}:read-through:v1`;
}

/** `null` both when nothing is stored and when the stored value is not a date. */
export function readStoredMarker(key: string): string | null {
  try {
    const value = window.localStorage.getItem(key);
    return value !== null && Number.isFinite(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

export function writeStoredMarker(key: string, marker: string): void {
  try {
    window.localStorage.setItem(key, marker);
  } catch {
    /* Losing the marker costs a badge, not a task — the feed itself is unaffected. */
  }
}

/**
 * A `null` marker counts as nothing unread: the first load seeds it from the
 * server's `generatedAt`, so an operator who already knows their open tasks does
 * not get a badge for the entire backlog the day this ships.
 */
export function unreadCount(
  items: readonly StaffNotification[],
  marker: string | null,
): number {
  if (marker === null) return 0;
  const markerTime = Date.parse(marker);
  if (!Number.isFinite(markerTime)) return 0;
  return items.filter((item) => Date.parse(item.createdAt) > markerTime).length;
}
