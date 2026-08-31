import Link from "next/link";
import { CATALOG_WRITE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { ProductForm } from "../_components/product-form";

export const metadata = { title: "افزودن محصول | پنل ادمین برات پی" };

export default async function NewProductPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/catalog">کاتالوگ</Link>
        <span>/</span>
        <span>محصول جدید</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>افزودن محصول</h1>
        </div>
      </div>
      <ProductForm />
    </div>
  );
}
