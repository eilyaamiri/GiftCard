import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminServiceSchema } from "../../catalog/_lib/catalog-contracts";
import { ServiceForm } from "../_components/service-form";
import { ServiceFieldPanel } from "../_components/service-field-panel";

export const metadata = { title: "ویرایش سرویس | پنل ادمین برات پی" };

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(CATALOG_WRITE_ROLES);
  const { id } = await params;

  let service;
  try {
    service = await api.get(`/api/admin/catalog/services/${id}`, adminServiceSchema);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/services">سرویس‌های بین‌المللی</Link>
        <span>/</span>
        <span>{service.nameFa}</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>{service.nameFa}</h1>
        </div>
      </div>

      <ServiceForm service={service} />
      <ServiceFieldPanel serviceId={service.id} fields={service.fields} />
    </div>
  );
}
