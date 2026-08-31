import { requireRole } from "@/lib/session";
import { OPERATOR_ROLES } from "@/lib/api";
import { CustomerSearchView } from "@/components/customer-search-view";

export const metadata = { title: "مشتریان | میزکار اپراتور برات پی" };

export default async function OperatorCustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(OPERATOR_ROLES);
  return <CustomerSearchView basePath="/operator/customers" params={await searchParams} />;
}
