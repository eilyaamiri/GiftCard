import { SupportTicketList } from "@/components/support-ticket-list";
import { OPERATOR_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { supportTickets } from "@/lib/support-tickets";

export const metadata = { title: "پشتیبانی و تیکت‌ها | میزکار اپراتور" };

export default async function OperatorSupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireRole(OPERATOR_ROLES);
  const query = await searchParams;
  const tickets = await supportTickets.list();
  return <SupportTicketList tickets={tickets} basePath="/operator/support" filter={single(query.view) ?? "open"} staffId={staff.id} />;
}

function single(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
