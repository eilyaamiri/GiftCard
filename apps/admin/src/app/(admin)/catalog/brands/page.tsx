import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminBrandListSchema, buildListSearch } from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { ToggleActiveButton } from "../_components/toggle-active-button";
import { CatalogTabs } from "../_components/catalog-tabs";

export const metadata = { title: "برندها | پنل ادمین برات پی" };

const BRAND_PAGE_SIZE = 40;

/**
 * Reads the brand list's own URL state.
 *
 * Separate from `readCatalogQuery` because this list filters on different
 * things: there is no product status here, and an operator hunting a duplicate
 * needs the inactive brands in view too.
 */
function readBrandQuery(params: Record<string, string | string[] | undefined>) {
  const first = (key: string): string | undefined => {
    const value = params[key];
    const single = Array.isArray(value) ? value[0] : value;
    return single !== undefined && single.trim() !== "" ? single.trim() : undefined;
  };
  const rawPage = Number.parseInt(first("page") ?? "1", 10);
  const search = first("search");
  return {
    page: Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1,
    // The API caps `search` at 120 characters and would 400 on anything longer.
    search: search?.slice(0, 120),
    includeInactive: first("includeInactive") === "true",
  };
}

type BrandQuery = ReturnType<typeof readBrandQuery>;

function brandsHref(query: BrandQuery, overrides: Partial<BrandQuery> = {}): string {
  const merged = { ...query, ...overrides, page: overrides.page ?? 1 };
  const params = new URLSearchParams();
  if (merged.search) params.set("search", merged.search);
  if (merged.includeInactive) params.set("includeInactive", "true");
  if (merged.page > 1) params.set("page", String(merged.page));
  const suffix = params.toString();
  return suffix ? `/catalog/brands?${suffix}` : "/catalog/brands";
}

export default async function BrandsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(CATALOG_WRITE_ROLES);

  const query = readBrandQuery(await searchParams);

  let list;
  try {
    list = await api.get(
      `/api/admin/catalog/brands${buildListSearch({
        page: query.page,
        pageSize: BRAND_PAGE_SIZE,
        includeInactive: query.includeInactive,
        ...(query.search ? { search: query.search } : {}),
      })}`,
      adminBrandListSchema,
    );
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <Heading />
        <CatalogTabs active="brands" />
        <div className="card panel">
          <p className="empty-hint">{error.message}</p>
        </div>
      </div>
    );
  }

  const { items, meta } = list;
  const currentPage = Math.min(meta.page, Math.max(meta.totalPages, 1));
  const firstRow = items.length === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastRow = firstRow + items.length - 1;

  return (
    <div>
      <Heading
        caption={
          items.length === 0
            ? "برندی یافت نشد"
            : `نمایش ${formatCount(firstRow)}–${formatCount(lastRow)} از ${formatCount(meta.total)} برند`
        }
      />
      <CatalogTabs active="brands" />

      <div className="toolbar">
        <form action="/catalog/brands" method="get" className="filter-bar" style={{ marginBlockEnd: 0 }}>
          <div className="search">
            <input
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder="نام فارسی، انگلیسی یا نشانهٔ برند"
              maxLength={120}
              aria-label="جست‌وجوی برند"
            />
          </div>
          <label className="filter" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            <input
              type="checkbox"
              name="includeInactive"
              value="true"
              defaultChecked={query.includeInactive}
            />
            نمایش غیرفعال‌ها
          </label>
          <button type="submit" className="filter">
            جست‌وجو
          </button>
          {query.search || query.includeInactive ? (
            <Link href="/catalog/brands" className="filter" style={FILTER_LINK}>
              پاک کردن
            </Link>
          ) : null}
        </form>
        <Link href="/catalog/brands/new" className="primary-btn taxonomy-cta">
          + افزودن برند
        </Link>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>برند</th>
                <th>نشانه</th>
                <th>محصول</th>
                <th>ترتیب</th>
                <th>وضعیت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((brand) => (
                <tr key={brand.id}>
                  <td>
                    <span className="taxonomy-name">
                      {brand.logoUrl ? (
                        /* The API's own stream route, not a remote host, so
                           next/image would add a loader for nothing. */
                        <img src={brand.logoUrl} alt="" className="taxonomy-logo" />
                      ) : (
                        <span className="taxonomy-logo taxonomy-logo-empty" aria-hidden="true" />
                      )}
                      <Link href={`/catalog/brands/${brand.id}`} className="order-id">
                        {brand.nameFa}
                      </Link>
                      {brand.isPopular ? <span className="badge badge-info">محبوب</span> : null}
                    </span>
                    <span className="table-subline" dir="ltr">
                      {brand.name}
                    </span>
                  </td>
                  <td dir="ltr">{brand.slug}</td>
                  <td>{formatCount(brand._count?.products ?? 0)}</td>
                  <td>{formatCount(brand.sortOrder)}</td>
                  <td>
                    <span className={`badge ${brand.isActive ? "badge-success" : "badge-danger"}`}>
                      {brand.isActive ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 8 }}>
                      <Link href={`/catalog?brandId=${brand.id}`} className="secondary-btn taxonomy-cta">
                        محصول‌ها
                      </Link>
                      <ToggleActiveButton
                        activate={!brand.isActive}
                        path={`/api/admin/catalog/brands/${brand.id}`}
                        confirmMessage={
                          brand.isActive
                            ? `برند «${brand.nameFa}» غیرفعال شود؟ محصولاتش حذف نمی‌شوند.`
                            : `برند «${brand.nameFa}» دوباره فعال شود؟`
                        }
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 ? (
          <p className="empty-hint">
            {query.search ? "برندی با این نام پیدا نشد." : "هنوز برندی ثبت نشده است."}
          </p>
        ) : null}
      </div>

      {meta.totalPages > 1 ? (
        <div className="filter-bar" style={{ justifyContent: "center", marginBlockStart: 18 }}>
          {currentPage > 1 ? (
            <Link href={brandsHref(query, { page: currentPage - 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ قبل
            </Link>
          ) : null}
          <span className="muted">
            صفحهٔ {formatCount(currentPage)} از {formatCount(meta.totalPages)}
          </span>
          {currentPage < meta.totalPages ? (
            <Link href={brandsHref(query, { page: currentPage + 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ بعد
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Heading({ caption }: { caption?: string }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>برندها</h1>
      </div>
      <p className="muted">{caption ?? ""}</p>
    </div>
  );
}

/** `.filter` is styled for buttons; an anchor needs the box model spelled out. */
const FILTER_LINK = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;
