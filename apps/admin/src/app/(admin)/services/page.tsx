import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminServiceListSchema } from "../catalog/_lib/catalog-contracts";
import { formatCount } from "../catalog/_lib/format";
import { ToggleActiveButton } from "../catalog/_components/toggle-active-button";

export const metadata = { title: "سرویس‌های بین‌المللی | پنل ادمین برات پی" };

export default async function ServicesPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  let list;
  try {
    list = await api.get("/api/admin/catalog/services?pageSize=100&includeInactive=true", adminServiceListSchema);
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
        <Link href="/services/new" className="primary-btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}>
          + افزودن سرویس
        </Link>
      </div>

      <div className="task-grid">
        {list.items.map((service) => (
          <div className="card task-panel" key={service.id}>
            <div className="panel-heading">
              <h2 className="panel-title">
                <Link href={`/services/${service.id}`} style={{ color: "inherit", textDecoration: "none" }}>
                  {service.nameFa}
                </Link>
              </h2>
              <span className="tag-pill">{service.category}</span>
            </div>
            <p className="panel-caption" style={{ marginBottom: 10 }}>فیلدهای فرم سفارش:</p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {service.fields.length === 0 ? (
                <span className="muted">بدون فیلد</span>
              ) : (
                service.fields.map((field) => (
                  <span key={field.id} className="tag-pill">{field.labelFa}</span>
                ))
              )}
            </div>
            <div className="save-row" style={{ marginTop: 16 }}>
              <Link href={`/services/${service.id}`} className="secondary-btn" style={{ display: "inline-flex", alignItems: "center", textDecoration: "none", marginInlineEnd: 10 }}>
                مدیریت
              </Link>
              <span className={`badge ${service.isActive ? "badge-success" : "badge-danger"}`} style={{ marginInlineEnd: "auto" }}>
                {service.isActive ? "فعال" : "غیرفعال"}
              </span>
              {service.isActive ? (
                <ToggleActiveButton
                  path={`/api/admin/catalog/services/${service.id}`}
                  confirmMessage={`سرویس «${service.nameFa}» غیرفعال شود؟`}
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
      {list.items.length === 0 ? (
        <div className="card panel">
          <p className="empty-hint">هنوز سرویسی ثبت نشده است.</p>
        </div>
      ) : null}
    </div>
  );
}

function PageHeading({ count }: { count?: number }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>سرویس‌های بین‌المللی</h1>
      </div>
      <p className="muted">{count === undefined ? "" : `${formatCount(count)} سرویس`}</p>
    </div>
  );
}
