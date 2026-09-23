import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { EmptyState, ErrorState } from "@barat/ui";
import { api, ApiClientError } from "@/lib/api";
import { catalogQueryString } from "@/lib/catalog";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { ServiceCard } from "@/components/service-card";

export const metadata = {
  title: "جست‌وجو | برات پی",
  description: "جست‌وجو در گیفت‌کارت‌ها و سرویس‌های پرداخت بین‌المللی.",
};

export const dynamic = "force-dynamic";

/** How many gift-card results to show before pointing to the full catalog. */
const PRODUCTS_SHOWN = 8;

function readTerm(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").trim().slice(0, 120);
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const term = readTerm((await searchParams).q);

  if (!term) {
    return (
      <main className="page container">
        <div className="eyebrow">جست‌وجو</div>
        <h1 className="h2">جست‌وجو در برات</h1>
        <EmptyState
          icon={<SearchX />}
          title="عبارتی برای جست‌وجو وارد نشده"
          description="نام یک گیفت‌کارت، برند یا سرویس پرداخت خارجی را در کادر جست‌وجوی بالای صفحه بنویسید."
        />
      </main>
    );
  }

  let products;
  let services;
  try {
    [products, services] = await Promise.all([
      api.products(catalogQueryString({ search: term, pageSize: PRODUCTS_SHOWN, onlyAvailable: false })),
      api.services({ search: term, pageSize: 50 }),
    ]);
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="جست‌وجو در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href={`/search?q=${encodeURIComponent(term)}`}>تلاش دوباره</Link>}
        />
      </main>
    );
  }

  const totalCount = products.meta.total + services.meta.total;

  return (
    <main className="page container">
      <div className="eyebrow">جست‌وجو</div>
      <h1 className="h2">نتایج جست‌وجو برای «{term}»</h1>

      {totalCount === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="چیزی پیدا نشد"
          description="نام دیگری برای گیفت‌کارت، برند یا سرویس پرداخت خارجی امتحان کنید."
        />
      ) : (
        <div className="services-category-stack" style={{ marginTop: 22 }}>
          {products.items.length > 0 ? (
            <section>
              <div className="section-head">
                <div>
                  <div className="eyebrow">گیفت‌کارت‌ها</div>
                  <h2 className="h2">گیفت‌کارت‌ها</h2>
                </div>
                {products.meta.total > products.items.length ? (
                  <Link className="btn btn-ghost" href={`/gift-cards?q=${encodeURIComponent(term)}`}>
                    دیدن همه <ArrowLeft size={16} />
                  </Link>
                ) : null}
              </div>
              <div className="grid catalog-grid">
                {products.items.map((product) => (
                  <CatalogProductCard key={product.id} product={product} />
                ))}
              </div>
            </section>
          ) : null}

          {services.items.length > 0 ? (
            <section>
              <div className="section-head">
                <div>
                  <div className="eyebrow">پرداخت بین‌المللی</div>
                  <h2 className="h2">پرداخت هزینه سرویس‌های خارجی</h2>
                </div>
                <Link className="btn btn-ghost" href="/services">
                  دیدن همه <ArrowLeft size={16} />
                </Link>
              </div>
              <div className="grid catalog-grid">
                {services.items.map((service) => (
                  <ServiceCard key={service.slug} service={service} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
