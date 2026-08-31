import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Ltr, formatJalaliDate } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";
import { api, ApiClientError } from "@/lib/api";
import { supportStatusView } from "@/lib/status";
import { ReplyForm } from "./reply-form";

export const dynamic = "force-dynamic";

export default async function AccountSupportTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;

  /* Another customer's ticket id answers 404 server-side, so a guessed id leaks
   * nothing — not even that the ticket exists. */
  const ticket = await api.supportRequest(ticketId).catch((error: unknown) => {
    if (error instanceof ApiClientError && error.isNotFound) notFound();
    throw error;
  });

  const view = supportStatusView(ticket.status);
  const closed = Boolean(ticket.resolutionNote) || ticket.status === "COMPLETED" || ticket.status === "CANCELLED";

  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">{ticket.subject}</h1>
      <AccountNav />

      <div className="card pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Badge tone={view.tone}>{view.label}</Badge>
          <span className="muted" style={{ fontSize: 12 }}>شمارهٔ پیگیری: <Ltr>{ticket.code}</Ltr></span>
        </div>
        <div className="summary-line" style={{ marginBlockStart: 14 }}>
          <span>تاریخ ثبت</span>
          <strong>{formatJalaliDate(ticket.createdAt)}</strong>
        </div>
        {ticket.orderNumber ? (
          <div className="summary-line">
            <span>سفارش مرتبط</span>
            <strong><Ltr>{ticket.orderNumber}</Ltr></strong>
          </div>
        ) : null}
        <div className="summary-line">
          <span>کارشناس پاسخ‌گو</span>
          <strong>{ticket.ownerStaffName ?? "در انتظار تخصیص"}</strong>
        </div>
        <div className="summary-line">
          <span>آخرین پاسخ پشتیبانی</span>
          <strong>{ticket.lastRespondedAt ? formatJalaliDate(ticket.lastRespondedAt) : "—"}</strong>
        </div>
      </div>

      <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 26 }}>گفت‌وگو</h2>
      <div className="support-thread">
        {ticket.messages.map((message) => (
          <div
            key={message.id}
            className={message.authorType === "STAFF" ? "support-bubble support-bubble-staff" : "support-bubble"}
          >
            <div className="support-bubble-head">
              <strong>{message.authorType === "STAFF" ? message.authorName : "شما"}</strong>
              <span>{formatJalaliDate(message.createdAt)}</span>
            </div>
            <p>{message.body}</p>
          </div>
        ))}
      </div>

      {closed ? (
        <div className="card pad" style={{ marginBlockStart: 16 }}>
          <strong>این درخواست بسته شده است.</strong>
          {ticket.resolutionNote ? <p style={{ margin: "8px 0 0" }}>{ticket.resolutionNote}</p> : null}
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 12 }}>
            در صورت نیاز، درخواست تازه‌ای ثبت کنید.
          </p>
        </div>
      ) : (
        <div style={{ marginBlockStart: 16 }}>
          <ReplyForm ticketId={ticket.id} />
        </div>
      )}

      <div className="hero-actions">
        <Link className="btn btn-outline" href="/account/support">بازگشت به پشتیبانی</Link>
      </div>
    </main>
  );
}
