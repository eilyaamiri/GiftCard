import Link from "next/link";
import { CATALOG_WRITE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { ServiceForm } from "../_components/service-form";

export const metadata = { title: "افزودن سرویس | پنل ادمین برات پی" };

export default async function NewServicePage() {
  await requireRole(CATALOG_WRITE_ROLES);

  return (
    <div>
      <div className="breadcrumb">
        <Link href="/services">سرویس‌های بین‌المللی</Link>
        <span>/</span>
        <span>سرویس جدید</span>
      </div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">کاتالوگ و تأمین</p>
          <h1>افزودن سرویس</h1>
        </div>
      </div>
      <ServiceForm />
    </div>
  );
}
