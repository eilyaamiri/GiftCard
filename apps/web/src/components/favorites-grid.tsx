"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { EmptyState } from "@barat/ui";
import { Heart } from "lucide-react";
import { FavoriteCard } from "@/components/favorite-card";
import type { AccountFavorite } from "@/lib/api";
import { favoritesSnapshot, primeFavorites, subscribeFavorites } from "@/lib/favorites-client";

/** Unhearting the last card here should leave the empty state, not a blank
 * grid — so this tracks the live count rather than trusting the server-fetched
 * length past the first render. */
export function FavoritesGrid({ initialFavorites }: Readonly<{ initialFavorites: readonly AccountFavorite[] }>) {
  primeFavorites(initialFavorites);
  const visibleCount = useSyncExternalStore(
    subscribeFavorites,
    () => initialFavorites.filter((favorite) => favoritesSnapshot(favorite.itemType, favorite.itemSlug)).length,
    () => initialFavorites.length,
  );

  if (visibleCount === 0) {
    return (
      <EmptyState
        icon={<Heart />}
        title="هنوز چیزی به علاقه‌مندی‌ها اضافه نکرده‌اید"
        description="با زدن نشان قلب روی هر گیفت‌کارت یا سرویس پرداخت، آن را اینجا ذخیره کنید."
        action={
          <Link className="btn btn-primary" href="/gift-cards">
            مشاهده گیفت‌کارت‌ها
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid catalog-grid" style={{ marginTop: 22 }}>
      {initialFavorites.map((favorite) => (
        <FavoriteCard key={`${favorite.itemType}:${favorite.itemSlug}`} favorite={favorite} />
      ))}
    </div>
  );
}
