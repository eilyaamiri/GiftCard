import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { ErrorState, toPersianDigits } from "@barat/ui";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { JsonLd } from "@/components/json-ld";
import { SiteTextSection } from "@/components/site-text";
import { api, ApiClientError } from "@/lib/api";
import { VISIBLE_BRAND_SLUGS, visibleBrandsQuery } from "@/lib/brand-art";
import { regionLabel, sortRegions } from "@/lib/regions";
import { catalogQueryString, type Brand, type ListCatalogProductsResponse } from "@/lib/catalog";
import { brandArticleSlug, getSiteArticle } from "@/lib/kb";
import { brandPath, breadcrumbJsonLd, catalogCanonicalPath, itemListJsonLd, pageMetadata, truncateForMeta } from "@/lib/seo";
import { RegionPicker } from "../../gift-cards/_components/catalog-sidebar";
import { CATALOG_PAGE_SIZE, catalogHref, readCatalogFilters } from "../../gift-cards/_lib/catalog-url";
import { BrandMark } from "../../gift-cards/_components/catalog-facets";

/** A brand switched off in the panel has to disappear on the next request. */
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/* The page and `generateMetadata` both need the brand; `cache` shares one request. */
const loadBrand = cache(async (slug: string): Promise<Brand | null> => {
  const { items } = await api.brands(visibleBrandsQuery());
  return items.find((brand) => brand.slug === slug) ?? null;
});

function leadFor(brand: Brand): string {
  return (
    brand.descriptionFa?.trim() ||
    `گیفت‌کارت ${brand.nameFa} را با مبلغ و منطقه‌ی دلخواه انتخاب کنید. قیمت نهایی پیش از پرداخت به شما نشان داده می‌شود.`
  );
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug } = await params;
  const { page, region } = readCatalogFilters(await searchParams);
  try {
    const brand = await loadBrand(slug);
    /* A slug the storefront does not show must not be indexed under a made-up title. */
    if (brand === null) return { title: "برند پیدا نشد", robots: { index: false } };
    return pageMetadata({
      title: `خرید گیفت‌کارت ${brand.nameFa}`,
      description: truncateForMeta(leadFor(brand)),
      /* A region is a view of the same page, not a page of its own. */
      path: catalogCanonicalPath({ brand: brand.slug, page: region ? 1 : page }),
      imageUrl: brand.logoUrl,
    });
  } catch {
    return {};
  }
}

/**
 * One brand: its title, its own text, and every card it has on sale.
 *
 * This is the page a search for «گیفت کارت اپل» should land on. The catalogue
 * at `/gift-cards?brand=<slug>` stays for filtering by region and amount, and
 * names this page as its canonical.
 */
export default async function BrandPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { page, region } = readCatalogFilters(await searchParams);

  let brand: Brand | null;
  let products: ListCatalogProductsResponse | null = null;
  try {
    brand = await loadBrand(slug);
    if (brand !== null) {
      products = await api.products(
        catalogQueryString({
          brandSlug: brand.slug,
          brandSlugs: VISIBLE_BRAND_SLUGS,
          region,
          page,
          pageSize: CATALOG_PAGE_SIZE,
          /* As in the catalogue: a card with no priced offer is still listed,
           * just without a buy button, so the brand's count agrees with the page. */
          onlyAvailable: false,
        }),
      );
    }
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="این برند در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={
            <Link className="btn btn-primary" href={brandPath(slug)}>
              تلاش دوباره
            </Link>
          }
        />
      </main>
    );
  }
  /* Outside the `try`: `notFound()` works by throwing, and must not be caught
   * and turned into the error page above. */
  if (brand === null || products === null) notFound();

  const { items, meta } = products;
  /* A brand with nothing on sale, or a page past the end, is not a page worth keeping. */
  if (region === undefined && (meta.total === 0 || items.length === 0)) notFound();

  const [fromPrices, siteText] = await Promise.all([
    api.fromPrices(items.map((product) => product.id)),
    getSiteArticle(brandArticleSlug(brand.slug)),
  ]);
  const path = brandPath(brand.slug);
  const lastPage = Math.max(meta.totalPages, 1);
  const current = Math.min(meta.page, lastPage);
  const regions = sortRegions(products.regions);
  const filters = { region, page: 1 };
  const pageHref = (target: number) => catalogHref(filters, { page: target }, path);

  return (
    <main className="page container catalog-page">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "خانه", path: "/" },
          { name: "برندها", path: "/brands" },
          { name: brand.nameFa, path },
        ])}
      />
      <JsonLd
        data={itemListJsonLd(
          items.map((product) => ({ name: product.titleFa, path: `/gift-cards/${encodeURIComponent(product.slug)}` })),
        )}
      />

      <nav className="breadcrumb" aria-label="مسیر صفحه">
        <Link href="/">خانه</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <Link href="/brands">برندها</Link>
        <ChevronLeft size={14} aria-hidden="true" />
        <span aria-current="page">{brand.nameFa}</span>
      </nav>

      <div className="eyebrow">برند</div>
      <h1 className="h2" style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <BrandMark brand={brand} size={40} />
        <span>گیفت‌کارت {brand.nameFa}</span>
      </h1>
      <p className="muted catalog-lead">{leadFor(brand)}</p>

      <div className="catalog-results-head">
        <p className="catalog-count">
          {toPersianDigits(meta.total)} گیفت‌کارت{region ? ` — منطقهٔ ${regionLabel(region) ?? region}` : ""}
        </p>
        <Link className="catalog-clear" href={catalogHref({ brand: brand.slug, region, page: 1 })}>
          مشاهده در فهرست کامل
        </Link>
      </div>

      <RegionPicker regions={regions} filters={filters} idPrefix="brand" pathname={path} />

      {items.length === 0 ? (
        <p className="muted">برای این منطقه گیفت‌کارتی پیدا نشد. منطقهٔ دیگری را انتخاب کنید.</p>
      ) : null}

      <div className="grid catalog-grid">
        {items.map((product) => (
          <CatalogProductCard key={product.id} product={product} fromPriceIrr={fromPrices[product.id]} />
        ))}
      </div>

      {meta.totalPages > 1 ? (
        <nav className="catalog-pager" aria-label="صفحه‌بندی">
          {current > 1 ? (
            <Link className="btn btn-outline" href={pageHref(current - 1)}>
              صفحهٔ قبل
            </Link>
          ) : null}
          <span className="muted">
            صفحهٔ {toPersianDigits(current)} از {toPersianDigits(lastPage)}
          </span>
          {current < lastPage ? (
            <Link className="btn btn-outline" href={pageHref(current + 1)}>
              صفحهٔ بعد
            </Link>
          ) : null}
        </nav>
      ) : null}

      <SiteTextSection article={siteText} id="brand-text-title" className="section" />
    </main>
  );
}
