import Link from "next/link";
import { CATALOG_WRITE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { BrandForm } from "../_components/brand-form";

export const metadata = { title: "افزودن برند | پنل ادمین برات پی" };

export default async function NewBrandPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/catalog">کاتالوگ</Link>
        <span>/</span>
        <Link href="/catalog/brands">برندها</Link>
        <span>/</span>
        <span>افزودن برند</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>افزودن برند</h1>
        </div>
      </div>

      <BrandForm />
    </div>
  );
}
