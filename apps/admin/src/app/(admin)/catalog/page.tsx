import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminProductListSchema } from "./_lib/catalog-contracts";
import { formatCount } from "./_lib/format";
import { ToggleActiveButton } from "./_components/toggle-active-button";

export const metadata = { title: "کاتالوگ | پنل ادمین برات پی" };

export default async function CatalogPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  let list;
  try {
    list = await api.get("/api/admin/catalog/products?pageSize=100&includeInactive=true", adminProductListSchema);
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

  return (
    <div>
      <PageHeading count={list.meta.total} />

      <div className="toolbar">
        <span />
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
              {list.items.map((product) => (
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
        {list.items.length === 0 ? <p className="empty-hint">هنوز محصولی ثبت نشده است.</p> : null}
      </div>
    </div>
  );
}

function PageHeading({ count }: { count?: number }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>کاتالوگ</h1>
      </div>
      <p className="muted">{count === undefined ? "" : `${formatCount(count)} محصول`}</p>
    </div>
  );
}
