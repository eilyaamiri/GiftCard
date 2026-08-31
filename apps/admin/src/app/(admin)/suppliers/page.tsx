import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { INTEGRATION_MODE_LABELS, adminSupplierListSchema } from "../catalog/_lib/catalog-contracts";
import { formatCount } from "../catalog/_lib/format";

export const metadata = { title: "تأمین‌کنندگان | پنل ادمین برات پی" };

export default async function SuppliersPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  let list;
  try {
    list = await api.get("/api/admin/catalog/suppliers?pageSize=100&includeInactive=true", adminSupplierListSchema);
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
        <Link href="/suppliers/new" className="primary-btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          + افزودن تأمین‌کننده
        </Link>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>تأمین‌کننده</th>
                <th>کد</th>
                <th>نوع اتصال</th>
                <th>تعداد Offer</th>
                <th>وضعیت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((supplier) => (
                <tr key={supplier.id}>
                  <td>
                    <Link href={`/suppliers/${supplier.id}`} className="order-id">
                      {supplier.name}
                    </Link>
                  </td>
                  <td className="bp-ltr">{supplier.code}</td>
                  <td>{INTEGRATION_MODE_LABELS[supplier.integrationMode]}</td>
                  <td>{formatCount(supplier._count?.offers ?? 0)}</td>
                  <td>
                    <span className={`badge ${supplier.isActive ? "badge-success" : "badge-danger"}`}>
                      {supplier.isActive ? "فعال" : "غیرفعال"}
                    </span>
                  </td>
                  <td>
                    <Link href={`/suppliers/${supplier.id}`} className="secondary-btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
                      مدیریت
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list.items.length === 0 ? <p className="empty-hint">هنوز تأمین‌کننده‌ای ثبت نشده است.</p> : null}
      </div>
    </div>
  );
}

function PageHeading({ count }: { count?: number }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>تأمین‌کنندگان</h1>
      </div>
      <p className="muted">{count === undefined ? "" : `${formatCount(count)} تأمین‌کننده`}</p>
    </div>
  );
}
