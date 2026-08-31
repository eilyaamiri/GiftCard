import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminProductDetailSchema } from "../_lib/catalog-contracts";
import { ProductForm } from "../_components/product-form";
import { SkuPanel } from "../_components/sku-panel";

export const metadata = { title: "ویرایش محصول | پنل ادمین برات پی" };

export default async function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(CATALOG_WRITE_ROLES);
  const { id } = await params;

  let product;
  try {
    product = await api.get(`/api/admin/catalog/products/${id}`, adminProductDetailSchema);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/catalog">کاتالوگ</Link>
        <span>/</span>
        <span>{product.titleFa}</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>{product.titleFa}</h1>
        </div>
      </div>

      <ProductForm product={product} />
      <SkuPanel productId={product.id} skus={product.skus} />
    </div>
  );
}
