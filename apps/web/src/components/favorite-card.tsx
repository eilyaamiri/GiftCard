"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowLeft } from "lucide-react";
import { Ltr } from "@barat/ui";
import { ProductArtwork, ServiceArtwork } from "@/components/catalog-artwork";
import { FavoriteButton } from "@/components/favorite-button";
import type { AccountFavorite } from "@/lib/api";
import { favoritesSnapshot, subscribeFavorites } from "@/lib/favorites-client";
import { serviceCategoryLabelFa } from "@/lib/service-categories";

/** One card on `/account/favorites`. Un-hearting it here removes it from the
 * grid immediately instead of leaving a stale card until the next reload. */
export function FavoriteCard({ favorite }: Readonly<{ favorite: AccountFavorite }>) {
  const stillFavorited = useSyncExternalStore(
    subscribeFavorites,
    () => favoritesSnapshot(favorite.itemType, favorite.itemSlug),
    () => true,
  );
  if (!stillFavorited) return null;

  if (favorite.itemType === "PRODUCT") {
    return (
      <Link href={favorite.href} className="card product catalog-card">
        <ProductArtwork
          brand={favorite.brand ?? ""}
          brandSlug={favorite.brandSlug}
          label={favorite.titleFa}
          overlay={<FavoriteButton itemType="PRODUCT" itemSlug={favorite.itemSlug} label={favorite.titleFa} />}
        />
        <div className="product-body">
          <p className="catalog-card-brand">
            <Ltr>{favorite.brand}</Ltr>
          </p>
          <h3>{favorite.titleFa}</h3>
        </div>
      </Link>
    );
  }

  return (
    <Link href={favorite.href} className="card service-card">
      <ServiceArtwork
        category={favorite.category ?? ""}
        label={favorite.titleFa}
        slug={favorite.itemSlug}
        overlay={<FavoriteButton itemType="SERVICE" itemSlug={favorite.itemSlug} label={favorite.titleFa} />}
      />
      <div className="service-card-body">
        <span className="service-card-category">{serviceCategoryLabelFa(favorite.category ?? "")}</span>
        <h3>{favorite.titleFa}</h3>
        <span className="service-card-action">
          درخواست پرداخت <ArrowLeft size={14} />
        </span>
      </div>
    </Link>
  );
}
