import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Ltr } from "@barat/ui";
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
