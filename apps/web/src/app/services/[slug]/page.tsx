import Link from "next/link";
import { notFound } from "next/navigation";
import { ErrorState } from "@barat/ui";
import { api, ApiClientError } from "@/lib/api";
import { ServiceForm } from "./service-form";

export const dynamic = "force-dynamic";

/**
 * There is no GET /api/catalog/services/:slug — the list endpoint already
 * embeds each service's full field definitions, so the detail page just
 * looks its slug up in that list rather than inventing an endpoint.
 */
export default async function ServiceDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  let items;
  try {
    ({ items } = await api.services());
  } catch (error) {
    return (
      <main className="page container" style={{ maxWidth: 560 }}>
        <ErrorState
          title="این سرویس در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href="/services">بازگشت به سرویس‌ها</Link>}
        />
      </main>
    );
  }

  const service = items.find((item) => item.slug === slug);
  if (!service) notFound();

  return <ServiceForm service={service} />;
}
