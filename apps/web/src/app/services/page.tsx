import Link from "next/link";
import { EmptyState, ErrorState } from "@barat/ui";
import { PackageSearch } from "lucide-react";
import { ApiClientError } from "@/lib/api";
import { listAllServices } from "@/lib/all-services";
import { getServiceContentSummary } from "@/lib/service-content";
import { ServiceCard } from "@/components/service-card";

export const dynamic = "force-dynamic";

export default async function ServicesPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const filters = await searchParams;
  let items;
  try {
    items = await listAllServices();
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

  const categoryOf = (slug: string, fallback: string) => getServiceContentSummary(slug)?.category ?? fallback;
  const categories = [...new Set(items.map((service) => categoryOf(service.slug, service.category)))];
  const query = filters.q?.trim() ?? "";
  const visible = items.filter((service) =>
    (!filters.category || categoryOf(service.slug, service.category) === filters.category) &&
    (!query || `${service.nameFa} ${service.name}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())));

  return (
    <main className="page container">
      <div className="eyebrow">پرداخت بین‌المللی</div>
      <h1 className="h2">پرداخت هزینه سرویس‌های خارجی</h1>
      <p className="muted">هزینه اشتراک‌ها، ابزارهای هوش مصنوعی، دامنه و هاستینگ، دوره‌های آموزشی و آزمون‌های بین‌المللی را با ریال بپردازید.</p>

      <form className="service-catalog-filters" action="/services" method="get">
        <label>جست‌وجوی خدمت<input name="q" defaultValue={query} placeholder="مثلاً اشتراک، آزمون یا هتل" /></label>
        <label>دسته‌بندی<select name="category" defaultValue={filters.category ?? ""}>
          <option value="">همه خدمات</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select></label>
        <button type="submit" className="btn btn-primary">جست‌وجو</button>
        <Link href="/services">نمایش همه</Link>
      </form>
      {visible.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title={items.length === 0 ? "در حال حاضر سرویسی موجود نیست" : "خدمتی با این مشخصات پیدا نشد"}
          description={items.length === 0 ? "فهرست سرویس‌ها به‌زودی به‌روزرسانی می‌شود. لطفاً بعداً دوباره سر بزنید." : "عبارت جست‌وجو یا دسته‌بندی را تغییر دهید."}
        />
      ) : (
        <div className="grid catalog-grid" style={{ marginTop: 22 }}>
          {visible.map((service) => (
            <ServiceCard key={service.slug} service={service} />
          ))}
        </div>
      )}
    </main>
  );
}
