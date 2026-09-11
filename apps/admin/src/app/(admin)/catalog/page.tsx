import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  adminProductListSchema,
  buildListSearch,
  catalogHref,
  readCatalogQuery,
} from "./_lib/catalog-contracts";
import { formatCount } from "./_lib/format";
import { ToggleActiveButton } from "./_components/toggle-active-button";

export const metadata = { title: "کاتالوگ | پنل ادمین برات پی" };

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(CATALOG_WRITE_ROLES);

  const query = readCatalogQuery(await searchParams);

  let list;
  try {
    list = await api.get(
      `/api/admin/catalog/products${buildListSearch({
        page: query.page,
        pageSize: query.pageSize,
        status: query.status,
        ...(query.search ? { search: query.search } : {}),
      })}`,
      adminProductListSchema,
    );
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <PageHeading />
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

  return (
    <div>
      <PageHeading
        caption={
          items.length === 0
            ? "محصولی یافت نشد"
            : `نمایش ${formatCount(firstRow)}–${formatCount(lastRow)} از ${formatCount(meta.total)} محصول`
        }
      />

      <div className="toolbar">
        {/* A plain GET form: the search stays in the URL, so it survives a
            reload, is shareable, and needs no client-side JavaScript. */}
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
          <label className="filter" style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
            وضعیت
            <select name="status" defaultValue={query.status} aria-label="فیلتر وضعیت محصول">
              <option value="ALL">همهٔ کارت‌ها</option>
              <option value="ACTIVE">فقط فعال‌ها</option>
              <option value="INACTIVE">فقط غیرفعال‌ها</option>
            </select>
          </label>
          <button type="submit" className="filter">
            جست‌وجو
          </button>
          {query.search ? (
            <Link href={catalogHref("/catalog", query, { search: "" })} className="filter" style={FILTER_LINK}>
              پاک کردن
            </Link>
          ) : null}
        </form>
        <Link href="/catalog/new" className="primary-btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          + افزودن محصول
        </Link>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>محصول</th>
                <th>برند</th>
                <th>دسته‌بندی</th>
                <th>تعداد SKU</th>
                <th>وضعیت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map((product) => (
                <tr key={product.id}>
                  <td>
                    <Link href={`/catalog/${product.id}`} className="order-id">
                      {product.titleFa}
                    </Link>
                  </td>
                  <td>{product.brand}</td>
                  <td>{product.category}</td>
                  <td>{formatCount(product._count?.skus ?? 0)}</td>
                  <td>
                    <span className={`badge ${product.isActive ? "badge-success" : "badge-danger"}`}>
                      {product.isActive ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td>
                    <span style={{ display: "inline-flex", gap: 8 }}>
                      <Link href={`/catalog/${product.id}`} className="secondary-btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                        مدیریت
                      </Link>
                      {product.isActive ? (
                        <ToggleActiveButton
                          path={`/api/admin/catalog/products/${product.id}`}
                          confirmMessage={`محصول «${product.titleFa}» غیرفعال شود؟`}
                        />
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 ? (
          <p className="empty-hint">
            {query.status === "ACTIVE"
              ? "کارت فعالی یافت نشد."
              : query.status === "INACTIVE"
                ? "کارت غیرفعالی یافت نشد."
                : "هنوز محصولی ثبت نشده است."}
          </p>
        ) : null}
      </div>

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

/** `.filter` is styled for buttons; an anchor needs the box model spelled out. */
const FILTER_LINK = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;
