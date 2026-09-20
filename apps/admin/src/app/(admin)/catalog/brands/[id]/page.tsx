import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminBrandOptionListSchema, adminBrandSchema } from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";
import { BrandForm } from "../_components/brand-form";
import { MergeBrandsForm } from "../_components/merge-brands-form";

export const metadata = { title: "ویرایش برند | پنل ادمین برات پی" };

export default async function BrandDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(CATALOG_WRITE_ROLES);
  const { id } = await params;

  let brand;
  try {
    brand = await api.get(`/api/admin/catalog/brands/${id}`, adminBrandSchema);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  const { items: options } = await api.get(
    "/api/admin/catalog/brands/options",
    adminBrandOptionListSchema,
  );

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/catalog">کاتالوگ</Link>
        <span>/</span>
        <Link href="/catalog/brands">برندها</Link>
        <span>/</span>
        <span>{brand.nameFa}</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>{brand.nameFa}</h1>
        </div>
        <p className="muted">
          {formatCount(brand._count?.products ?? 0)} محصول ·{" "}
          <Link href={`/catalog?brandId=${brand.id}`}>مشاهدهٔ محصول‌ها</Link>
        </p>
      </div>

      <BrandForm brand={brand} />
      <MergeBrandsForm brand={brand} options={options} />
    </div>
  );
}
