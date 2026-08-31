import { redirect } from "next/navigation";
import { SupportTicketDetail } from "@/components/support-ticket-detail";
import { OPERATOR_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { supportTickets } from "@/lib/support-tickets";

export const metadata = { title: "پاسخ به تیکت | میزکار اپراتور" };

export default async function OperatorSupportTicketPage({ params, searchParams }: { params: Promise<{ ticketId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ticketId } = await params;
  await requireRole(OPERATOR_ROLES);
  const ticket = await supportTickets.get(ticketId);
  const query = await searchParams;

  async function reply(formData: FormData): Promise<void> {
    "use server";
    await requireRole(OPERATOR_ROLES);
    const message = String(formData.get("message") ?? "").trim();
    if (message.length < 3 || message.length > 2000) return;
    await supportTickets.reply(ticketId, message);
    redirect(`/operator/support/${encodeURIComponent(ticketId)}?saved=reply`);
  }
  async function close(formData: FormData): Promise<void> {
    "use server";
    await requireRole(OPERATOR_ROLES);
    const note = String(formData.get("resolutionNote") ?? "").trim();
    if (note.length < 3 || note.length > 2000) return;
    await supportTickets.close(ticketId, note);
    redirect(`/operator/support/${encodeURIComponent(ticketId)}?saved=closed`);
  }

  return <SupportTicketDetail ticket={ticket} basePath="/operator/support" customerBasePath="/operator/customers" replyAction={reply} closeAction={close} saved={single(query.saved)} />;
}

function single(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
