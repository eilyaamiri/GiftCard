import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminCategoryListSchema, adminCategorySchema } from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";
import { CategoryForm } from "../_components/category-form";

export const metadata = { title: "ویرایش دسته‌بندی | پنل ادمین برات پی" };

export default async function CategoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(CATALOG_WRITE_ROLES);
  const { id } = await params;

  let category;
  try {
    category = await api.get(`/api/admin/catalog/categories/${id}`, adminCategorySchema);
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }
  const { items: parents } = await api.get("/api/admin/catalog/categories", adminCategoryListSchema);
  const total = (category._count?.products ?? 0) + (category._count?.productTags ?? 0);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/catalog">کاتالوگ</Link>
        <span>/</span>
        <Link href="/catalog/categories">دسته‌بندی‌ها</Link>
        <span>/</span>
        <span>{category.nameFa}</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>{category.nameFa}</h1>
        </div>
        <p className="muted">
          {/* Both counts, because a product can sit here as a related category
              as well as its primary one. */}
          {formatCount(total)} محصول در این دسته ·{" "}
          <Link href={`/catalog?categoryId=${category.id}`}>مشاهدهٔ محصول‌ها</Link>
        </p>
      </div>

      <CategoryForm category={category} parents={parents} />
    </div>
  );
}
