import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import { CategoryIcon } from "@/components/category-icon";
import { brandAccent, brandInitials } from "@/lib/brand-mark";
import type { Brand, Category } from "@/lib/catalog";
import { catalogHref, type CatalogFilters } from "../_lib/catalog-url";

/**
 * The two browsing paths, as lists of links.
 *
 * Deliberately free of hooks and event handlers so the same markup serves the
 * desktop sidebar (rendered on the server) and the phone drawer (rendered in a
 * client component). A facet is a link, not a control: the filter it applies is
 * a URL, which is what makes a filtered catalog shareable and the back button
 * behave.
 */

export function CategoryFacets({
  categories,
  filters,
  onNavigate,
}: Readonly<{
  categories: readonly Category[];
  filters: CatalogFilters;
  /** The drawer passes its own dismissal; the sidebar has nothing to dismiss. */
  onNavigate?: (() => void) | undefined;
}>) {
  return (
    <ul className="facet-list">
      {categories.map((category) => {
        const active = filters.category === category.slug;
        return (
          <li key={category.id}>
            <Link
              className={active ? "facet-item is-active" : "facet-item"}
              href={catalogHref(filters, { category: active ? undefined : category.slug })}
              aria-current={active ? "true" : undefined}
              onClick={onNavigate}
            >
              <span className="facet-icon" aria-hidden="true">
                <CategoryIcon iconKey={category.iconKey} size={17} />
              </span>
              <span className="facet-label">{category.nameFa}</span>
              <span className="facet-count">{toPersianDigits(category.productCount)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function BrandFacets({
  brands,
  filters,
  onNavigate,
}: Readonly<{
  brands: readonly Brand[];
  filters: CatalogFilters;
  onNavigate?: (() => void) | undefined;
}>) {
  return (
    <ul className="facet-list">
      {brands.map((brand) => {
        const active = filters.brand === brand.slug;
        return (
          <li key={brand.id}>
            <Link
              className={active ? "facet-item is-active" : "facet-item"}
              href={catalogHref(filters, { brand: active ? undefined : brand.slug })}
              aria-current={active ? "true" : undefined}
              onClick={onNavigate}
            >
              <BrandMark brand={brand} />
              <span className="facet-label">{brand.nameFa}</span>
              <span className="facet-count">{toPersianDigits(brand.productCount)}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A brand's logo, or a designed mark where there is no logo yet.
 *
 * Almost every brand arrived from the supplier catalog without artwork, and
 * there is no way for either this app or its server to fetch one from the
 * internet. Two initials on a palette-derived background keep the row the
 * same height as its neighbours and give each brand a mark of its own,
 * rather than a placeholder that looks the same for all of them.
 */
export function BrandMark({ brand, size = 30 }: Readonly<{ brand: Brand; size?: number }>) {
  if (brand.logoUrl === null) {
    const { base, accent } = brandAccent(brand.slug);
    return (
      <span
        className="facet-logo facet-logo-empty"
        aria-hidden="true"
        style={{ width: size, height: size, background: base, color: accent, fontSize: Math.round(size * 0.4) }}
      >
        {brandInitials(brand.name)}
      </span>
    );
  }
  return (
    /* Streamed by the API from this same host — there is no remote loader for
     * next/image to configure, and a brand logo is already a small flat file. */
    <img
      className="facet-logo"
      src={brand.logoUrl}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
    />
  );
}
