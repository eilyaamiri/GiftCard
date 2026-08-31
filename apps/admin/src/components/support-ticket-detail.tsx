import Link from "next/link";
import type { SupportTicket } from "@/lib/support-tickets";
import { formatDateTime } from "@/lib/order-format";

const OWNER_REASON: Record<string, string> = {
  FIRST_STAFF_REPLY: "مالکیت با اولین پاسخ کارشناس ایجاد شد",
  STAFF_REPLY_TAKEOVER: "مالکیت با پاسخ کارشناس دیگری منتقل شد",
  LEGACY_ASSIGNEE_BACKFILL: "مالک قبلی سامانه ثبت شد",
};

export function SupportTicketDetail({
  ticket,
  basePath,
  customerBasePath,
  replyAction,
  closeAction,
  saved,
}: {
  ticket: SupportTicket;
  basePath: string;
  customerBasePath: string;
  replyAction: (formData: FormData) => Promise<void>;
  closeAction: (formData: FormData) => Promise<void>;
  saved: string | undefined;
}) {
  const closed = ["COMPLETED", "FAILED", "CANCELLED"].includes(ticket.status);
  return <div>
    <div className="breadcrumb"><Link href={basePath}>تیکت‌های پشتیبانی</Link><span>/</span><span>{ticket.code}</span></div>
    <div className="page-heading"><div><p className="eyebrow">{ticket.code}</p><h1>{ticket.subject}</h1></div><span className={`badge ${ticket.responseBreached ? "badge-danger" : closed ? "badge-success" : "badge-info"}`}>{ticket.responseBreached ? "خارج از SLA" : closed ? "بسته" : ticket.status}</span></div>
    {saved === "reply" ? <p className="customer-save-success">پاسخ ثبت شد و مالک فعلی تیکت به‌روزرسانی شد.</p> : null}
    {saved === "closed" ? <p className="customer-save-success">تیکت بسته شد.</p> : null}

    <div className="two-col support-ticket-workspace">
      <main className="workspace-main">
        <section className="card panel">
          <div className="section-label"><h2>گفت‌وگو</h2><span>{ticket.messages.length} پیام</span></div>
          <div className="support-conversation">{ticket.messages.map((message) => <article key={message.id} className={`support-message support-message-${message.authorType.toLowerCase()}`}><header><strong>{message.authorName}</strong><span>{message.authorType === "CUSTOMER" ? "مشتری" : "کارشناس"} · {formatDateTime(message.createdAt)}</span></header><p>{message.body}</p></article>)}</div>
        </section>
        {!closed ? <section className="card panel"><div className="section-label"><h2>پاسخ به مشتری</h2><span>با ثبت پاسخ، شما مالک تیکت می‌شوید</span></div><form action={replyAction} className="customer-note-form"><label>متن پاسخ<textarea name="message" minLength={3} maxLength={2000} required placeholder="پاسخ روشن و قابل اقدام برای مشتری" /></label><button className="primary-btn" type="submit">ثبت پاسخ و پذیرش مالکیت</button></form></section> : null}
      </main>

      <aside className="workspace-control">
        <section className="card panel"><div className="section-label"><h2>اطلاعات تیکت</h2><span>{ticket.status}</span></div><div className="kv-list">
          <div className="kv-row"><span>مشتری</span><Link href={`${customerBasePath}/${encodeURIComponent(ticket.customerId)}`}>{ticket.customerName ?? ticket.customerCode}</Link></div>
          <div className="kv-row"><span>سفارش</span><span>{ticket.orderNumber ?? "بدون سفارش"}</span></div>
          <div className="kv-row"><span>مالک فعلی</span><strong>{ticket.ownerStaffName ?? "بدون مالک"}</strong></div>
          <div className="kv-row"><span>مهلت پاسخ اول</span><span>{formatDateTime(ticket.firstResponseDueAt)}</span></div>
          <div className="kv-row"><span>پاسخ اول</span><span>{ticket.firstRespondedAt ? formatDateTime(ticket.firstRespondedAt) : "هنوز ثبت نشده"}</span></div>
          <div className="kv-row"><span>مهلت پاسخ جاری</span><span>{formatDateTime(ticket.nextResponseDueAt)}</span></div>
        </div></section>
        <section className="card panel"><div className="section-label"><h2>تاریخچه مالکیت</h2><span>{ticket.ownershipHistory.length} تغییر</span></div>{ticket.ownershipHistory.length === 0 ? <p className="empty-hint">هنوز کارشناسی پاسخ نداده است.</p> : <div className="timeline">{ticket.ownershipHistory.map((event) => <div className="timeline-row" key={event.id}><span className="timeline-dot" /><div className="timeline-copy"><strong>{event.previousOwnerName ? `${event.previousOwnerName} ← ${event.newOwnerName}` : event.newOwnerName}</strong><span>{OWNER_REASON[event.reason] ?? event.reason}</span><span>{formatDateTime(event.createdAt)}</span></div></div>)}</div>}</section>
        {!closed ? <section className="card panel"><div className="section-label"><h2>بستن تیکت</h2><span>پایان پیگیری</span></div><form action={closeAction} className="customer-note-form"><label>جمع‌بندی<textarea name="resolutionNote" minLength={3} maxLength={2000} required /></label><button className="secondary-btn" type="submit">بستن تیکت</button></form></section> : ticket.resolutionNote ? <section className="card panel"><div className="section-label"><h2>جمع‌بندی</h2><span>بسته‌شده</span></div><p>{ticket.resolutionNote}</p></section> : null}
      </aside>
    </div>
  </div>;
}
