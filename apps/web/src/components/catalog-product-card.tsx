import Link from "next/link";
import { Ltr } from "@barat/ui";
import { ProductArtwork } from "@/components/catalog-artwork";
import type { CatalogProduct } from "@/lib/catalog";

/** Beyond three, the region line wraps and stops being scannable. */
const REGIONS_SHOWN = 3;

/**
 * One gift card in the grid.
 *
 * A product whose data is still incomplete is shown — the catalog never hides
 * one — but it is not a link and has no call to action, because there is
 * nothing to price at the other end. The API refuses to quote it either; this
 * is the half the customer can see.
 */
export function CatalogProductCard({
  product,
  region,
}: {
  readonly product: CatalogProduct;
  /** The region filter the customer was browsing under, if the product still offers it. */
  readonly region?: string | undefined;
}) {
  const brand = product.brandNameFa ?? product.brand;
  const orderable = !product.needsReview && product.regions.length > 0;
  const carriedRegion = region && product.regions.includes(region) ? region : undefined;
  const href = carriedRegion
    ? `/gift-cards/${product.slug}?region=${encodeURIComponent(carriedRegion)}`
    : `/gift-cards/${product.slug}`;

  const body = (
    <>
      {/* Supplier photos vary wildly in style and quality across a catalog
       * fed by hundreds of brands, so the card never renders `imageUrl`
       * directly — commissioned cover art where we have it, and the generated
       * icon-on-plate mark everywhere else, keeps the grid visually consistent
       * regardless of what any one supplier sent. */}
      <ProductArtwork brand={product.brand} brandSlug={product.brandSlug} label={product.titleFa} />
      <div className="product-body">
        <p className="catalog-card-brand">{brand}</p>
        <h3>{product.titleFa}</h3>
        <div className="product-meta">
          <span>
            {product.regions.length === 0 ? (
              "منطقه‌ای ثبت نشده"
            ) : (
              <>
                منطقه <Ltr>{product.regions.slice(0, REGIONS_SHOWN).join("، ")}</Ltr>
                {product.regions.length > REGIONS_SHOWN
                  ? ` و ${product.regions.length - REGIONS_SHOWN} منطقهٔ دیگر`
                  : null}
              </>
            )}
          </span>
          <span className={orderable ? "catalog-card-cta" : "catalog-card-cta is-off"}>
            {orderable ? "دریافت قیمت" : "فعلاً قابل سفارش نیست"}
          </span>
        </div>
      </div>
    </>
  );

  if (!orderable) {
    return (
      <div className="card product catalog-card catalog-card-off" aria-disabled="true">
        {body}
      </div>
    );
  }

  return (
    <Link href={href} className="card product catalog-card">
      {body}
    </Link>
  );
}
