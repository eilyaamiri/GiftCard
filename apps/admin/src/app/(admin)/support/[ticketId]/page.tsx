import { redirect } from "next/navigation";
import { SupportTicketDetail } from "@/components/support-ticket-detail";
import { SUPPORT_TICKET_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { supportTickets } from "@/lib/support-tickets";

export const metadata = { title: "جزئیات تیکت | پنل ادمین برات پی" };

export default async function SupportTicketPage({ params, searchParams }: { params: Promise<{ ticketId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ticketId } = await params;
  await requireRole(SUPPORT_TICKET_ROLES);
  const ticket = await supportTickets.get(ticketId);
  const query = await searchParams;

  async function reply(formData: FormData): Promise<void> {
    "use server";
    await requireRole(SUPPORT_TICKET_ROLES);
    const message = String(formData.get("message") ?? "").trim();
    if (message.length < 3 || message.length > 2000) return;
    await supportTickets.reply(ticketId, message);
    redirect(`/support/${encodeURIComponent(ticketId)}?saved=reply`);
  }
  async function close(formData: FormData): Promise<void> {
    "use server";
    await requireRole(SUPPORT_TICKET_ROLES);
    const note = String(formData.get("resolutionNote") ?? "").trim();
    if (note.length < 3 || note.length > 2000) return;
    await supportTickets.close(ticketId, note);
    redirect(`/support/${encodeURIComponent(ticketId)}?saved=closed`);
  }

  return <SupportTicketDetail ticket={ticket} basePath="/support" customerBasePath="/customers" replyAction={reply} closeAction={close} saved={single(query.saved)} />;
}

function single(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
