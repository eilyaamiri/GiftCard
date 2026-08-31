import { SupportTicketList } from "@/components/support-ticket-list";
import { SUPPORT_TICKET_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { supportTickets } from "@/lib/support-tickets";

export const metadata = { title: "تیکت‌های پشتیبانی | پنل ادمین برات پی" };

export default async function SupportPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const staff = await requireRole(SUPPORT_TICKET_ROLES);
  const query = await searchParams;
  const view = single(query.view) ?? "open";
  const tickets = await supportTickets.list();
  return <SupportTicketList tickets={tickets} basePath="/support" filter={view} staffId={staff.id} />;
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
