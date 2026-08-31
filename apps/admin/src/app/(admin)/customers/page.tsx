import { requireRole } from "@/lib/session";
import { CUSTOMER_VIEW_ROLES } from "@/lib/api";
import { CustomerSearchView } from "@/components/customer-search-view";

export const metadata = { title: "نمای ۳۶۰ مشتری | پنل ادمین برات پی" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(CUSTOMER_VIEW_ROLES);
  return <CustomerSearchView basePath="/customers" params={await searchParams} />;
}
