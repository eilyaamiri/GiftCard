import { api, ApiClientError, type FavoriteItemType } from "@/lib/api";

function key(itemType: FavoriteItemType, itemSlug: string): string {
  return `${itemType}:${itemSlug}`;
}

type Listener = () => void;

/**
 * One shared client-side cache of "what has this customer starred", not one
 * fetch per heart button. A catalog grid renders dozens of `FavoriteButton`s at
 * once; without this each would ask `/api/account/favorites` on its own mount.
 *
 * `slugs` is `null` until the first load resolves. An anonymous visitor's
 * request 401s, which resolves it to an empty set rather than retrying forever
 * — the button still renders, it just starts unstarred and sends a signed-out
 * click to `/login`.
 */
let slugs: Set<string> | null = null;
let loadPromise: Promise<void> | null = null;
let signedOut = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureLoaded(): void {
  if (slugs !== null || loadPromise) return;
  loadPromise = api
    .accountFavorites()
    .then((items) => {
      slugs = new Set(items.map((item) => key(item.itemType, item.itemSlug)));
      notify();
    })
    .catch((error) => {
      loadPromise = null;
      if (error instanceof ApiClientError && error.isUnauthenticated) {
        signedOut = true;
        slugs = new Set();
        notify();
        return;
      }
      /* A transient failure leaves `slugs` at `null` so the next subscriber
       * (or a retry click) tries again instead of getting stuck empty. */
    });
}

/**
 * Seeds the store from a server-rendered list instead of re-fetching it
 * client-side. Called synchronously during a client component's render (not an
 * effect), so it's set before that component's own children read it — a no-op
 * once the store is already loaded, so it never clobbers a toggle made
 * elsewhere in the same session.
 */
export function primeFavorites(items: readonly { itemType: FavoriteItemType; itemSlug: string }[]): void {
  if (slugs !== null) return;
  slugs = new Set(items.map((item) => key(item.itemType, item.itemSlug)));
}

export function subscribeFavorites(listener: Listener): () => void {
  listeners.add(listener);
  ensureLoaded();
  return () => listeners.delete(listener);
}

export function favoritesSnapshot(itemType: FavoriteItemType, itemSlug: string): boolean {
  return slugs?.has(key(itemType, itemSlug)) ?? false;
}

export function isSignedOut(): boolean {
  return signedOut;
}

export async function toggleFavorite(itemType: FavoriteItemType, itemSlug: string): Promise<void> {
  const itemKey = key(itemType, itemSlug);
  const wasFavorited = slugs?.has(itemKey) ?? false;
  if (!slugs) slugs = new Set();
  if (wasFavorited) slugs.delete(itemKey);
  else slugs.add(itemKey);
  notify();

  try {
    if (wasFavorited) await api.removeFavorite(itemType, itemSlug);
    else await api.addFavorite({ itemType, itemSlug });
  } catch (error) {
    if (wasFavorited) slugs.add(itemKey);
    else slugs.delete(itemKey);
    notify();
    throw error;
  }
}
