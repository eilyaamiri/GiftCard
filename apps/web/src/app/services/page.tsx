import Link from "next/link";
import { EmptyState, ErrorState } from "@barat/ui";
import { ChevronLeft, PackageSearch } from "lucide-react";
import type { InternationalServiceDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { ServiceCard, ServiceCategoryCard } from "@/components/service-card";
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

function readCategory(raw: string | string[] | undefined): { slug: string; labelFa: string } | undefined {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return SERVICE_CATEGORIES.find((category) => category.slug === value);
}

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const activeCategory = readCategory((await searchParams).category);

  let items;
  try {
    ({ items } = activeCategory ? await api.services({ category: activeCategory.slug }) : await api.services());
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

  const breadcrumb = (
    <nav className="breadcrumb" aria-label="مسیر صفحه">
      <Link href="/">خانه</Link>
      <ChevronLeft size={14} aria-hidden="true" />
      {activeCategory === undefined ? (
        <span aria-current="page">پرداخت بین‌المللی</span>
      ) : (
        <>
          <Link href="/services">پرداخت بین‌المللی</Link>
          <ChevronLeft size={14} aria-hidden="true" />
          <span aria-current="page">{activeCategory.labelFa}</span>
        </>
      )}
    </nav>
  );

  if (activeCategory !== undefined) {
    const generic = items.find((service) => GENERIC_SERVICE_SLUGS.includes(service.slug));
    const specific = items.filter((service) => service !== generic);
    const sorted = generic ? [...specific, generic] : specific;

    return (
      <main className="page container">
        {breadcrumb}
        <div className="eyebrow">پرداخت بین‌المللی</div>
        <h1 className="h2">{activeCategory.labelFa}</h1>
        <p className="muted catalog-lead">
          {generic?.descriptionFa ?? "هزینه این دسته از سرویس‌های خارجی را با ریال بپردازید."}
        </p>

        {sorted.length === 0 ? (
          <EmptyState
            icon={<PackageSearch />}
            title="در حال حاضر سرویسی موجود نیست"
            description="فهرست سرویس‌های این دسته به‌زودی به‌روزرسانی می‌شود. لطفاً بعداً دوباره سر بزنید."
          />
        ) : (
          <div className="grid catalog-grid" style={{ marginTop: 22 }}>
            {sorted.map((service) => (
              <ServiceCard key={service.slug} service={service} />
            ))}
          </div>
        )}
      </main>
    );
  }

  const groups = groupByCategory(items);

  return (
    <main className="page container">
      {breadcrumb}
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
        <div className="grid catalog-grid" style={{ marginTop: 22 }}>
          {groups.map((group) => (
            <ServiceCategoryCard
              key={group.slug}
              slug={group.slug}
              labelFa={group.labelFa}
              descriptionFa={group.descriptionFa}
              count={group.items.length}
            />
          ))}
        </div>
      )}
    </main>
  );
}
