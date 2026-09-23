"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { useToast } from "@barat/ui";
import { ApiClientError, type FavoriteItemType } from "@/lib/api";
import { favoritesSnapshot, isSignedOut, subscribeFavorites, toggleFavorite } from "@/lib/favorites-client";

/**
 * The heart on a gift card or service. Sits inside `ProductArtwork`/
 * `ServiceArtwork` (passed as their `overlay` prop) so it shares the artwork's
 * `.catalog-art` stacking context, which is itself inside a `<Link>` on every
 * card — hence the `preventDefault`/`stopPropagation`, or a click here would
 * also navigate the card.
 */
export function FavoriteButton({
  itemType,
  itemSlug,
  label,
}: Readonly<{ itemType: FavoriteItemType; itemSlug: string; label: string }>) {
  const favorited = useSyncExternalStore(
    subscribeFavorites,
    () => favoritesSnapshot(itemType, itemSlug),
    () => false,
  );
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const { push } = useToast();

  async function handleClick(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (pending) return;
    if (isSignedOut()) {
      router.push("/login");
      return;
    }
    setPending(true);
    try {
      await toggleFavorite(itemType, itemSlug);
    } catch (error) {
      if (error instanceof ApiClientError && error.isUnauthenticated) {
        router.push("/login");
      } else {
        push({ title: "علاقه‌مندی‌ها به‌روزرسانی نشد", description: "لطفاً دوباره تلاش کنید.", tone: "danger" });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className={favorited ? "favorite-button is-active" : "favorite-button"}
      onClick={handleClick}
      aria-pressed={favorited}
      aria-label={favorited ? `حذف ${label} از علاقه‌مندی‌ها` : `افزودن ${label} به علاقه‌مندی‌ها`}
    >
      <Heart size={16} strokeWidth={2} fill={favorited ? "currentColor" : "none"} />
    </button>
  );
}
