import { redirect } from "next/navigation";
import { Customer360View } from "@/components/customer-360-view";
import { CUSTOMER_NOTE_ROLES, OPERATOR_ROLES } from "@/lib/api";
import { addCustomerNote, fetchCustomer360 } from "@/lib/customer-360";
import { requireRole } from "@/lib/session";

export const metadata = { title: "جزئیات مشتری | میزکار اپراتور برات پی" };

export default async function OperatorCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { customerId } = await params;
  const staff = await requireRole(OPERATOR_ROLES);
  const data = await fetchCustomer360(customerId);
  const query = await searchParams;
  const canAddNote = CUSTOMER_NOTE_ROLES.includes(staff.role as (typeof CUSTOMER_NOTE_ROLES)[number]);

  async function saveNote(formData: FormData): Promise<void> {
    "use server";
    const note = String(formData.get("body") ?? "").trim();
    if (note.length < 1 || note.length > 2_000) return;
    await requireRole(CUSTOMER_NOTE_ROLES);
    await addCustomerNote(customerId, note, formData.get("isPinned") === "true");
    redirect(`/operator/customers/${encodeURIComponent(customerId)}?saved=1`);
  }

  return <Customer360View data={data} basePath="/operator/customers" canAddNote={canAddNote} addNoteAction={saveNote} saved={single(query.saved) === "1"} />;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
