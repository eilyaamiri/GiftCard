import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EmptyState, ErrorState, Ltr } from "@barat/ui";
import { PackageSearch } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  let items;
  try {
    ({ items } = await api.services());
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="فهرست سرویس‌ها در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href="/services">تلاش دوباره</Link>}
        />
      </main>
    );
  }

  return (
    <main className="page container">
      <div className="eyebrow">پرداخت بین‌المللی</div>
      <h1 className="h2">پرداخت هزینه سرویس‌های خارجی</h1>
      <p className="muted">هزینه اشتراک‌ها، ابزارهای هوش مصنوعی، دامنه و هاستینگ، دوره‌های آموزشی و آزمون‌های بین‌المللی را با ریال بپردازید.</p>

      {items.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title="در حال حاضر سرویسی موجود نیست"
          description="فهرست سرویس‌ها به‌زودی به‌روزرسانی می‌شود. لطفاً بعداً دوباره سر بزنید."
        />
      ) : (
        <div className="grid catalog-grid" style={{ marginTop: 22 }}>
          {items.map((service) => (
            <Link key={service.slug} href={`/services/${service.slug}`} className="card pad" style={{ display: "block" }}>
              <span className="chip" style={{ pointerEvents: "none", marginBottom: 12, display: "inline-block" }}>{service.category}</span>
              <h3 style={{ margin: "4px 0 6px" }}>{service.nameFa}</h3>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>ارز پایه: <Ltr>{service.currency}</Ltr></p>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, color: "var(--teal)", fontWeight: 700, fontSize: 13 }}>
                درخواست پرداخت <ArrowLeft size={14} />
              </span>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
