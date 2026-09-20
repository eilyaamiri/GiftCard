import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  adminBrandOptionListSchema,
  adminCategoryListSchema,
  adminProductListSchema,
  buildListSearch,
  catalogHref,
  readCatalogQuery,
  type AdminBrandOption,
  type AdminCategory,
} from "./_lib/catalog-contracts";
import { formatCount } from "./_lib/format";
import { CatalogTabs } from "./_components/catalog-tabs";
import { ProductTable } from "./_components/product-table";

export const metadata = { title: "کاتالوگ | پنل ادمین برات پی" };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(CATALOG_WRITE_ROLES);

  const query = readCatalogQuery(await searchParams);

  let list;
  let categories: AdminCategory[];
  let brands: AdminBrandOption[];
  try {
    /* Three independent reads. The filters are useless without the taxonomy
     * lists, so they go out together rather than one after the other. */
    const [products, categoryList, brandList] = await Promise.all([
      api.get(
        `/api/admin/catalog/products${buildListSearch({
          page: query.page,
          pageSize: query.pageSize,
          status: query.status,
          ...(query.search ? { search: query.search } : {}),
          ...(query.categoryId ? { categoryId: query.categoryId } : {}),
          ...(query.brandId ? { brandId: query.brandId } : {}),
          ...(query.needsReview ? { needsReview: true } : {}),
        })}`,
        adminProductListSchema,
      ),
      api.get("/api/admin/catalog/categories", adminCategoryListSchema),
      api.get("/api/admin/catalog/brands/options", adminBrandOptionListSchema),
    ]);
    list = products;
    categories = categoryList.items;
    brands = brandList.items;
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <PageHeading />
        <CatalogTabs active="products" />
        <div className="card panel">
          <p className="empty-hint">{error.message}</p>
        </div>
      </div>
    );
  }

  const { items, meta } = list;
  // The API echoes back whatever page was asked for, so a hand-typed `?page=999`
  // comes back empty with page 999 in the meta. Clamping keeps the range caption
  // and the prev/next links honest.
  const currentPage = Math.min(meta.page, Math.max(meta.totalPages, 1));
  const firstRow = items.length === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastRow = firstRow + items.length - 1;
  const hasFilter =
    Boolean(query.search) ||
    Boolean(query.categoryId) ||
    Boolean(query.brandId) ||
    query.needsReview === true ||
    query.status !== "ALL";

  return (
    <div>
      <PageHeading
        caption={
          items.length === 0
            ? "محصولی یافت نشد"
            : `نمایش ${formatCount(firstRow)}–${formatCount(lastRow)} از ${formatCount(meta.total)} محصول`
        }
      />
      <CatalogTabs active="products" />

      <div className="toolbar">
        {/* A plain GET form: the filters stay in the URL, so they survive a
            reload, are shareable, and need no client-side JavaScript. */}
        <form action="/catalog" method="get" className="filter-bar" style={{ marginBlockEnd: 0 }}>
          <div className="search">
            <input
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder="نام یا شناسهٔ محصول"
              maxLength={120}
              aria-label="جست‌وجوی محصول"
            />
          </div>
          <label className="filter" style={INLINE_FILTER}>
            دسته‌بندی
            <select name="categoryId" defaultValue={query.categoryId ?? ""} aria-label="فیلتر دسته‌بندی">
              <option value="">همهٔ دسته‌ها</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.nameFa}
                </option>
              ))}
            </select>
          </label>
          <label className="filter" style={INLINE_FILTER}>
            برند
            <select name="brandId" defaultValue={query.brandId ?? ""} aria-label="فیلتر برند">
              <option value="">همهٔ برندها</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.nameFa}
                </option>
              ))}
            </select>
          </label>
          <label className="filter" style={INLINE_FILTER}>
            وضعیت
            <select name="status" defaultValue={query.status} aria-label="فیلتر وضعیت محصول">
              <option value="ALL">همهٔ کارت‌ها</option>
              <option value="ACTIVE">فقط فعال‌ها</option>
              <option value="INACTIVE">فقط غیرفعال‌ها</option>
            </select>
          </label>
          <label className="filter" style={INLINE_FILTER}>
            <input
              type="checkbox"
              name="needsReview"
              value="true"
              defaultChecked={query.needsReview === true}
            />
            نیازمند بازبینی
          </label>
          <button type="submit" className="filter">
            جست‌وجو
          </button>
          {hasFilter ? (
            <Link href="/catalog" className="filter" style={FILTER_LINK}>
              پاک کردن فیلترها
            </Link>
          ) : null}
        </form>
        <Link href="/catalog/new" className="primary-btn taxonomy-cta">
          + افزودن محصول
        </Link>
      </div>

      <ProductTable
        items={items}
        categories={categories}
        emptyHint={
          query.needsReview
            ? "محصولی در صف بازبینی نیست."
            : hasFilter
              ? "با این فیلترها محصولی یافت نشد."
              : "هنوز محصولی ثبت نشده است."
        }
      />

      {meta.totalPages > 1 ? (
        <div className="filter-bar" style={{ justifyContent: "center", marginBlockStart: 18 }}>
          {currentPage > 1 ? (
            <Link href={catalogHref("/catalog", query, { page: currentPage - 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ قبل
            </Link>
          ) : null}
          <span className="muted">
            صفحهٔ {formatCount(currentPage)} از {formatCount(meta.totalPages)}
          </span>
          {currentPage < meta.totalPages ? (
            <Link href={catalogHref("/catalog", query, { page: currentPage + 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ بعد
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * `caption` carries the row range rather than a bare total: with 2,400 products
 * behind a pager, "۲٬۴۰۶ محصول" alone leaves the operator unsure which twenty
 * of them are on screen.
 */
function PageHeading({ caption }: { caption?: string }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>کاتالوگ</h1>
      </div>
      <p className="muted">{caption ?? ""}</p>
    </div>
  );
}

const INLINE_FILTER = { display: "inline-flex", alignItems: "center", gap: 7 } as const;

/** `.filter` is styled for buttons; an anchor needs the box model spelled out. */
const FILTER_LINK = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;
