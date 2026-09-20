import Link from "next/link";
import { EmptyState, ErrorState, toPersianDigits } from "@barat/ui";
import { ChevronLeft, PackageSearch, Search, SearchX } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { catalogQueryString, type Brand, type Category } from "@/lib/catalog";
import { CATALOG_PAGE_SIZE, catalogHref, hasActiveFilter, readCatalogFilters } from "./_lib/catalog-url";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { CatalogBrowser } from "./_components/catalog-browser";
import { CatalogSidebar } from "./_components/catalog-sidebar";

export const metadata = {
  title: "گیفت‌کارت‌ها | برات پی",
  description: "گیفت‌کارت‌های دیجیتال جهان را بر اساس دسته‌بندی، برند و منطقه پیدا کنید.",
};

/**
 * Never cached. A product the operator switches off has to leave the catalog on
 * the next request, not at the end of a revalidation window — and the same for
 * a new brand, a new category or a new denomination.
 */
export const dynamic = "force-dynamic";

export default async function GiftCardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = readCatalogFilters(await searchParams);

  let categories: readonly Category[];
  let brands: readonly Brand[];
  let products;
  try {
    /* Three independent reads. The results are meaningless without the facets
     * beside them, so they go out together rather than one after the other. */
    [categories, brands, products] = await Promise.all([
      api.categories().then((response) => response.items),
      api.brands().then((response) => response.items),
      api.products(
        catalogQueryString({
          categorySlug: filters.category,
          brandSlug: filters.brand,
          region: filters.region,
          search: filters.q,
          page: filters.page,
          pageSize: CATALOG_PAGE_SIZE,
          /* A product with no priced offer is still listed — hiding it would
           * make the category counts disagree with what the page shows — but it
           * is listed without a buy button. */
          onlyAvailable: false,
        }),
      ),
    ]);
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="فهرست گیفت‌کارت‌ها در دسترس نیست"
          description={
            error instanceof ApiClientError
              ? error.message
              : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."
          }
          action={
            <Link className="btn btn-primary" href="/gift-cards">
              تلاش دوباره
            </Link>
          }
        />
      </main>
    );
  }

  const { items, meta, regions } = products;
  const activeCategory = categories.find((category) => category.slug === filters.category);
  const activeBrand = brands.find((brand) => brand.slug === filters.brand);
  const filtered = hasActiveFilter(filters);
  const lastPage = Math.max(meta.totalPages, 1);
  const page = Math.min(meta.page, lastPage);

  return (
    <main className="page container catalog-page">
      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <Link href="/">خانه</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        {activeCategory === undefined && activeBrand === undefined ? (
          <span aria-current="page">گیفت‌کارت‌ها</span>
        ) : (
          <>
            <Link href="/gift-cards">گیفت‌کارت‌ها</Link>
            <ChevronLeft size={14} aria-hidden="true" />
            <span aria-current="page">{activeCategory?.nameFa ?? activeBrand?.nameFa}</span>
          </>
        )}
      </nav>

      <div className="eyebrow">کاتالوگ</div>
      <h1 className="h2">{activeCategory?.nameFa ?? activeBrand?.nameFa ?? "گیفت‌کارت‌ها"}</h1>
      <p className="muted catalog-lead">
        {activeCategory?.descriptionFa ??
          activeBrand?.descriptionFa ??
          "کارت‌های دیجیتال جهان را بر اساس دسته‌بندی، برند یا منطقه پیدا کنید. قیمت نهایی پیش از پرداخت به شما نشان داده می‌شود."}
      </p>

      {/* A plain GET form: the search lives in the URL like every other filter,
          so it survives a reload and needs no JavaScript to work. */}
      <form action="/gift-cards" method="get" className="catalog-search" role="search">
        {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
        {filters.brand ? <input type="hidden" name="brand" value={filters.brand} /> : null}
        {filters.region ? <input type="hidden" name="region" value={filters.region} /> : null}
        <Search size={19} aria-hidden="true" />
        <input
          type="search"
          name="q"
          defaultValue={filters.q ?? ""}
          maxLength={120}
          placeholder="نام گیفت‌کارت یا برند را بنویسید"
          aria-label="جست‌وجو در گیفت‌کارت‌ها"
        />
        <button type="submit" className="btn btn-teal">
          جست‌وجو
        </button>
      </form>

      <CatalogBrowser categories={categories} brands={brands} filters={filters} />

      <div className="catalog-layout">
        <CatalogSidebar
          categories={categories}
          brands={brands}
          regions={regions}
          filters={filters}
        />

        <div className="catalog-results">
          <div className="catalog-results-head">
            <p className="catalog-count">
              {meta.total === 0
                ? "بدون نتیجه"
                : `${toPersianDigits(meta.total)} گیفت‌کارت`}
            </p>
            {filtered ? (
              <Link
                className="catalog-clear"
                href={catalogHref(filters, {
                  category: undefined,
                  brand: undefined,
                  region: undefined,
                  q: undefined,
                })}
              >
                پاک کردن فیلترها
              </Link>
            ) : null}
          </div>

          {filtered ? (
            <div className="catalog-active-filters">
              {activeCategory ? (
                <FilterChip
                  label={activeCategory.nameFa}
                  href={catalogHref(filters, { category: undefined })}
                />
              ) : null}
              {activeBrand ? (
                <FilterChip
                  label={activeBrand.nameFa}
                  href={catalogHref(filters, { brand: undefined })}
                />
              ) : null}
              {filters.region ? (
                <FilterChip
                  label={`منطقهٔ ${filters.region}`}
                  href={catalogHref(filters, { region: undefined })}
                />
              ) : null}
              {filters.q ? (
                <FilterChip
                  label={`«${filters.q}»`}
                  href={catalogHref(filters, { q: undefined })}
                />
              ) : null}
            </div>
          ) : null}

          {items.length === 0 ? (
            filtered ? (
              <EmptyState
                icon={<SearchX />}
                title="چیزی با این فیلترها پیدا نشد"
                description="یک دسته‌بندی یا برند دیگر را امتحان کنید، یا فیلترها را پاک کنید."
              />
            ) : (
              <EmptyState
                icon={<PackageSearch />}
                title="در حال حاضر گیفت‌کارتی موجود نیست"
                description="کاتالوگ به‌زودی به‌روزرسانی می‌شود. لطفاً بعداً دوباره سر بزنید."
              />
            )
          ) : (
            <div className="grid catalog-grid">
              {items.map((product) => (
                <CatalogProductCard key={product.id} product={product} region={filters.region} />
              ))}
            </div>
          )}

          {meta.totalPages > 1 ? (
            <nav className="catalog-pager" aria-label="صفحه‌بندی">
              {page > 1 ? (
                <Link className="btn btn-outline" href={catalogHref(filters, { page: page - 1 })}>
                  صفحهٔ قبل
                </Link>
              ) : null}
              <span className="muted">
                صفحهٔ {toPersianDigits(page)} از {toPersianDigits(lastPage)}
              </span>
              {page < lastPage ? (
                <Link className="btn btn-outline" href={catalogHref(filters, { page: page + 1 })}>
                  صفحهٔ بعد
                </Link>
              ) : null}
            </nav>
          ) : null}
        </div>
      </div>
    </main>
  );
}

/** An applied filter, with the way to undo it attached. */
function FilterChip({ label, href }: Readonly<{ label: string; href: string }>) {
  return (
    <Link className="catalog-filter-chip" href={href}>
      {label}
      <span aria-hidden="true">×</span>
      <span className="catalog-chip-hint"> — حذف این فیلتر</span>
    </Link>
  );
}
