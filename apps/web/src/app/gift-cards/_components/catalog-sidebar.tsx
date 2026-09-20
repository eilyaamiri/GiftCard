import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import type { Brand, Category } from "@/lib/catalog";
import { catalogHref, type CatalogFilters } from "../_lib/catalog-url";
import { BrandFacets, CategoryFacets } from "./catalog-facets";

/** Enough to recognise the strip as a shortcut, not as the brand list itself. */
const POPULAR_SHOWN = 8;

/**
 * The filter panel, on a pointer screen.
 *
 * Always open, alongside the results, because on a wide screen there is room to
 * see what is being filtered and what the filter did at the same time. The
 * phone gets the same facets through the drawer instead.
 */
export function CatalogSidebar({
  categories,
  brands,
  regions,
  filters,
}: Readonly<{
  categories: readonly Category[];
  brands: readonly Brand[];
  regions: readonly string[];
  filters: CatalogFilters;
}>) {
  /* Curated by an operator. With none flagged, the API's own order stands in —
   * there are no sales figures here, and a made-up ranking would be worse than
   * the catalog's order. */
  const popular = brands.filter((brand) => brand.isPopular);
  const shortlist = (popular.length > 0 ? popular : brands).slice(0, POPULAR_SHOWN);

  return (
    <aside className="catalog-aside" aria-label="فیلترها">
      <section className="card catalog-facet-card">
        <h2 className="catalog-facet-title">دسته‌بندی‌ها</h2>
        {categories.length === 0 ? (
          <p className="catalog-facet-empty">دسته‌بندی فعالی ثبت نشده است.</p>
        ) : (
          <CategoryFacets categories={categories} filters={filters} />
        )}
      </section>

      <section className="card catalog-facet-card">
        <div className="catalog-facet-head">
          <h2 className="catalog-facet-title">برندهای محبوب</h2>
          <Link className="catalog-facet-more" href="/brands">
            همهٔ برندها
          </Link>
        </div>
        {shortlist.length === 0 ? (
          <p className="catalog-facet-empty">برندی ثبت نشده است.</p>
        ) : (
          <BrandFacets brands={shortlist} filters={filters} />
        )}
      </section>

      <section className="card catalog-facet-card">
        <h2 className="catalog-facet-title">منطقه</h2>
        <RegionPicker regions={regions} filters={filters} />
      </section>
    </aside>
  );
}

/**
 * The region filter.
 *
 * A select rather than chips: the catalog spans 158 regions, and a chip row
 * that long is a wall. It is a plain GET form, so it works with no JavaScript —
 * the hidden fields carry the filters that are already applied so choosing a
 * region narrows the current view instead of replacing it.
 */
export function RegionPicker({
  regions,
  filters,
  idPrefix = "catalog",
}: Readonly<{
  regions: readonly string[];
  filters: CatalogFilters;
  idPrefix?: string;
}>) {
  const selectId = `${idPrefix}-region`;

  if (regions.length === 0) {
    return <p className="catalog-facet-empty">منطقه‌ای برای این نتایج ثبت نشده است.</p>;
  }

  return (
    <form action="/gift-cards" method="get" className="catalog-region-form">
      {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
      {filters.brand ? <input type="hidden" name="brand" value={filters.brand} /> : null}
      {filters.q ? <input type="hidden" name="q" value={filters.q} /> : null}
      <select
        id={selectId}
        name="region"
        defaultValue={filters.region ?? ""}
        aria-label="منطقهٔ گیفت‌کارت"
      >
        <option value="">همهٔ منطقه‌ها ({toPersianDigits(regions.length)})</option>
        {regions.map((region) => (
          <option key={region} value={region}>
            {region}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-outline catalog-region-submit">
        اعمال
      </button>
      {filters.region ? (
        <Link className="catalog-facet-more" href={catalogHref(filters, { region: undefined })}>
          حذف منطقه
        </Link>
      ) : null}
    </form>
  );
}
