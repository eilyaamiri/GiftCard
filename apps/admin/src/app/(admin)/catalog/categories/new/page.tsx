import Link from "next/link";
import { CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminCategoryListSchema } from "../../_lib/catalog-contracts";
import { CategoryForm } from "../_components/category-form";

export const metadata = { title: "افزودن دسته‌بندی | پنل ادمین برات پی" };

export default async function NewCategoryPage() {
  await requireRole(CATALOG_WRITE_ROLES);
  const { items } = await api.get("/api/admin/catalog/categories", adminCategoryListSchema);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/catalog">کاتالوگ</Link>
        <span>/</span>
        <Link href="/catalog/categories">دسته‌بندی‌ها</Link>
        <span>/</span>
        <span>دستهٔ جدید</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>افزودن دسته‌بندی</h1>
        </div>
      </div>
      <CategoryForm parents={items} />
    </div>
  );
}
