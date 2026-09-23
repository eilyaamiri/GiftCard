import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Ltr, toPersianDigits } from "@barat/ui";
import type { InternationalServiceDto } from "@barat/contracts";
import { ServiceArtwork } from "@/components/catalog-artwork";
import { serviceCategoryLabelFa } from "@/lib/service-categories";

export function ServiceCard({ service }: { readonly service: InternationalServiceDto }) {
  return (
    <Link href={`/services/${service.slug}`} className="card service-card">
      <ServiceArtwork
        category={service.category}
        label={service.nameFa}
        slug={service.slug}
      />
      <div className="service-card-body">
        <span className="service-card-category">{serviceCategoryLabelFa(service.category)}</span>
        <h3>{service.nameFa}</h3>
        <p className="muted">
          ارز پایه: <Ltr>{service.currency}</Ltr>
        </p>
        <span className="service-card-action">
          درخواست پرداخت <ArrowLeft size={14} />
        </span>
      </div>
    </Link>
  );
}

/**
 * The card for a payment category on the `/services` landing view — one per
 * entry in `SERVICE_CATEGORIES`, six today. It reuses `ServiceArtwork` keyed
 * by the category's own slug (every category slug is also a key in
 * `SERVICE_ICONS`) so the art matches what a service card from that category
 * would show, without needing a second icon set just for the overview.
 */
export function ServiceCategoryCard({
  slug,
  labelFa,
  descriptionFa,
  count,
}: Readonly<{ slug: string; labelFa: string; descriptionFa: string | null; count: number }>) {
  return (
    <Link href={`/services?category=${encodeURIComponent(slug)}`} className="card service-card">
      <ServiceArtwork category={slug} label={labelFa} slug={slug} />
      <div className="service-card-body">
        <span className="service-card-category">{toPersianDigits(count)} سرویس</span>
        <h3>{labelFa}</h3>
        <p className="muted">{descriptionFa ?? "هزینه این دسته از سرویس‌های خارجی را با ریال بپردازید."}</p>
        <span className="service-card-action">
          مشاهده سرویس‌ها <ArrowLeft size={14} />
        </span>
      </div>
    </Link>
  );
}
