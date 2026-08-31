import Link from "next/link";
import { CATALOG_WRITE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { SupplierForm } from "../_components/supplier-form";

export const metadata = { title: "افزودن تأمین‌کننده | پنل ادمین برات پی" };

export default async function NewSupplierPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/suppliers">تأمین‌کنندگان</Link>
        <span>/</span>
        <span>تأمین‌کنندهٔ جدید</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>افزودن تأمین‌کننده</h1>
        </div>
      </div>
      <SupplierForm />
    </div>
  );
}
