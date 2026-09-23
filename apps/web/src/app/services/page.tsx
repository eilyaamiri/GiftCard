import Link from "next/link";
import { EmptyState, ErrorState } from "@barat/ui";
import { PackageSearch } from "lucide-react";
import type { InternationalServiceDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { ServiceCard } from "@/components/service-card";
import { GENERIC_SERVICE_SLUGS, SERVICE_CATEGORIES } from "@/lib/service-categories";

export const dynamic = "force-dynamic";

/** Every service in one category, specific ones first and the generic fallback last. */
function groupByCategory(
  items: readonly InternationalServiceDto[],
): { slug: string; labelFa: string; descriptionFa: string | null; items: InternationalServiceDto[] }[] {
  return SERVICE_CATEGORIES.map((category) => {
    const inCategory = items.filter((service) => service.category === category.slug);
    const generic = inCategory.find((service) => GENERIC_SERVICE_SLUGS.includes(service.slug));
    const specific = inCategory.filter((service) => service !== generic);
    return {
      slug: category.slug,
      labelFa: category.labelFa,
      descriptionFa: generic?.descriptionFa ?? null,
      items: generic ? [...specific, generic] : specific,
    };
  }).filter((group) => group.items.length > 0);
}

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

  const groups = groupByCategory(items);

  return (
    <main className="page container">
      <div className="eyebrow">پرداخت بین‌المللی</div>
      <h1 className="h2">پرداخت هزینه سرویس‌های خارجی</h1>
      <p className="muted">هزینه اشتراک‌ها، ابزارهای هوش مصنوعی، دامنه و هاستینگ، دوره‌های آموزشی و آزمون‌های بین‌المللی را با ریال بپردازید.</p>

      {groups.length === 0 ? (
        <EmptyState
          icon={<PackageSearch />}
          title="در حال حاضر سرویسی موجود نیست"
          description="فهرست سرویس‌ها به‌زودی به‌روزرسانی می‌شود. لطفاً بعداً دوباره سر بزنید."
        />
      ) : (
        <div className="services-category-stack" style={{ marginTop: 22 }}>
          {groups.map((group) => (
            <section key={group.slug} className="services-category-section">
              <h2>{group.labelFa}</h2>
              {group.descriptionFa ? <p className="muted">{group.descriptionFa}</p> : null}
              <div className="grid catalog-grid" style={{ marginTop: 14 }}>
                {group.items.map((service) => (
                  <ServiceCard key={service.slug} service={service} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
