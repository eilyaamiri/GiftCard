import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { Ltr } from "@barat/ui";
import type { InternationalServiceDto } from "@barat/contracts";
import { ServiceArtwork } from "@/components/catalog-artwork";
import { getServiceContentSummary } from "@/lib/service-content";

export function ServiceCard({ service }: { readonly service: InternationalServiceDto }) {
  const content = getServiceContentSummary(service.slug);
  return (
    <Link href={`/services/${service.slug}`} className="card service-card">
      {content ? <div className="service-document-art"><Image src={content.image.src} alt={content.image.alt}
        width={content.image.width} height={content.image.height} sizes="(max-width: 600px) 45vw, 260px" /></div> : <ServiceArtwork
        category={service.category}
        label={service.nameFa}
        slug={service.slug}
      />}
      <div className="service-card-body">
        <span className="service-card-category">{content?.category ?? service.category}</span>
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
