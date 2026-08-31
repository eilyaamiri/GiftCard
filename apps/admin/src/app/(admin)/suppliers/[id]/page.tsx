import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminSkuListSchema, adminSupplierDetailSchema } from "../../catalog/_lib/catalog-contracts";
import { SupplierForm } from "../_components/supplier-form";
import { OfferPanel } from "../_components/offer-panel";

export const metadata = { title: "ویرایش تأمین‌کننده | پنل ادمین برات پی" };

export default async function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(CATALOG_WRITE_ROLES);
  const { id } = await params;

  let supplier;
  try {
    supplier = await api.get(`/api/admin/catalog/suppliers/${id}`, adminSupplierDetailSchema);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }

  /* Needed only to populate the "add offer" SKU picker — a supplier's own
   * detail never carries the full SKU catalog. */
  const skuList = await api.get("/api/admin/catalog/skus?pageSize=100&includeInactive=true", adminSkuListSchema);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/suppliers">تأمین‌کنندگان</Link>
        <span>/</span>
        <span>{supplier.name}</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>{supplier.name}</h1>
        </div>
      </div>

      <SupplierForm supplier={supplier} />
      <OfferPanel supplierId={supplier.id} offers={supplier.offers} skus={skuList.items} />
    </div>
  );
}
