import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, ErrorState, toPersianDigits } from "@barat/ui";
import { ChevronLeft, Gamepad2, PackageSearch, Search, SearchX } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { catalogQueryString, type Brand, type Category } from "@/lib/catalog";
import { VISIBLE_BRAND_SLUGS, visibleBrandsQuery } from "@/lib/brand-art";
import { regionLabel, sortRegions } from "@/lib/regions";
import { GIFT_CARDS_PAGE_ARTICLE_SLUG, getSiteArticle } from "@/lib/kb";
import { SiteTextSection } from "@/components/site-text";
import { catalogCanonicalPath, pageMetadata } from "@/lib/seo";
import { CATALOG_PAGE_SIZE, catalogHref, hasActiveFilter, readCatalogFilters } from "./_lib/catalog-url";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { CatalogBrowser } from "./_components/catalog-browser";
import { CatalogSidebar } from "./_components/catalog-sidebar";

const CATALOG_TITLE = "گیفت‌کارت‌ها";
const CATALOG_DESCRIPTION = "گیفت‌کارت‌های دیجیتال جهان را بر اساس دسته‌بندی، برند و منطقه پیدا کنید.";

/**
 * Each category and each brand is a page worth finding on its own, so it gets
 * its own title, description and canonical. A search result is not: it is
 * `noindex`, and its canonical folds into the list it was run on. An unknown
 * category or brand slug is `noindex` too, so a mistyped link never becomes a
 * page of its own in the index.
 */
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const filters = readCatalogFilters(await searchParams);
  const path = catalogCanonicalPath(filters);
  let title = CATALOG_TITLE;
  let description: string = CATALOG_DESCRIPTION;
  let unknownSlug = false;
  try {
    if (filters.brand !== undefined && filters.category === undefined) {
      const brand = (await api.brands(visibleBrandsQuery())).items.find((item) => item.slug === filters.brand);
      if (brand === undefined) unknownSlug = true;
      else {
        title = `خرید گیفت‌کارت ${brand.nameFa}`;
        description = brand.descriptionFa?.trim() || `گیفت‌کارت ${brand.nameFa} را با مبلغ و منطقه‌ی دلخواه ببینید و با ریال بخرید؛ قیمت نهایی پیش از پرداخت.`;
      }
    } else if (filters.category !== undefined && filters.brand === undefined) {
      const category = (await api.categories(visibleBrandsQuery())).items.find((item) => item.slug === filters.category);
      if (category === undefined) unknownSlug = true;
      else {
        title = `خرید گیفت‌کارت ${category.nameFa}`;
        description = category.descriptionFa?.trim() || `گیفت‌کارت‌های ${category.nameFa} را ببینید و با ریال بخرید؛ قیمت نهایی پیش از پرداخت.`;
      }
    }
  } catch {
    /* The taxonomy is unreachable: fall back to the generic title rather than
     * fail the page, and say nothing about indexing either way. */
  }
  return pageMetadata({ title, description, path, noindex: filters.q !== undefined || unknownSlug });
}

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
      /* A service list is not a facet of the product grid: filtering by it
       * would always come back empty. */
      api
        .categories(visibleBrandsQuery())
        .then((response) => response.items.filter((category) => category.kind === "PRODUCTS")),
      api.brands(visibleBrandsQuery()).then((response) => response.items),
      api.products(
        catalogQueryString({
          categorySlug: filters.category,
          brandSlug: filters.brand,
          /* The shelf, not a filter: the same scope goes on all three reads, so
           * the tile counts, the brand list and the grid agree on what exists. */
          brandSlugs: VISIBLE_BRAND_SLUGS,
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

  const { items, meta } = products;
  /* The API orders regions by code; a customer reads them by name. */
  const regions = sortRegions(products.regions);
  /* After the list, because it needs the page's ids; fail-open by design, so a
   * pricing hiccup costs the cards their «از ...» label and nothing more. */
  const fromPrices = await api.fromPrices(items.map((product) => product.id));
  const activeCategory = categories.find((category) => category.slug === filters.category);
  const activeBrand = brands.find((brand) => brand.slug === filters.brand);
  const filtered = hasActiveFilter(filters);
  /* Only the plain catalogue carries the text: a filtered view is a different
   * list under the same URL, and repeating one block across every filter
   * combination would be duplicate copy. */
  const siteText = filtered ? null : await getSiteArticle(GIFT_CARDS_PAGE_ARTICLE_SLUG);
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

      {/* Gaming gift cards and direct game top-ups are different products: a
          card hands over a code, a top-up credits the player's account. A
          customer who came here for the second is pointed to its own section. */}
      {activeCategory?.slug === "gaming" ? (
        <p className="alert catalog-topup-hint">
          <Gamepad2 size={15} aria-hidden="true" />
          <span>
            می‌خواهید بدون کد، مستقیم حساب بازی‌تان شارژ شود؟{" "}
            <Link href="/games">شارژ مستقیم بازی</Link>
          </span>
        </p>
      ) : null}

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
        <button type="submit" className="btn btn-accent">
          جست‌وجو
        </button>
      </form>

      <CatalogBrowser categories={categories} brands={brands} regions={regions} filters={filters} />

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
                  label={`منطقهٔ ${regionLabel(filters.region)}`}
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
                <CatalogProductCard
                  key={product.id}
                  product={product}
                  region={filters.region}
                  fromPriceIrr={fromPrices[product.id]}
                />
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

      <SiteTextSection article={siteText} id="gift-cards-text-title" className="section" />
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
