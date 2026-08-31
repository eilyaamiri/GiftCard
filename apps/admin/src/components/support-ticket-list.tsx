import Link from "next/link";
import { toPersianDigits } from "@barat/ui";
import type { SupportTicket } from "@/lib/support-tickets";
import { formatDateTime } from "@/lib/order-format";

const FILTERS = [
  ["open", "باز"],
  ["unassigned", "بدون مالک"],
  ["mine", "تیکت‌های من"],
  ["overdue", "خارج از SLA"],
  ["closed", "بسته"],
] as const;

export function SupportTicketList({
  tickets,
  basePath,
  filter,
  staffId,
}: {
  tickets: readonly SupportTicket[];
  basePath: string;
  filter: string;
  staffId: string;
}) {
  const visible = tickets.filter((ticket) => {
    if (filter === "unassigned") return ticket.ownerStaffId === null && !isClosed(ticket);
    if (filter === "mine") return ticket.ownerStaffId === staffId && !isClosed(ticket);
    if (filter === "overdue") return ticket.responseBreached && !isClosed(ticket);
    if (filter === "closed") return isClosed(ticket);
    return !isClosed(ticket);
  });

  return <div>
    <div className="page-heading"><div><p className="eyebrow">SUPPORT · SLA CONTROL</p><h1>پشتیبانی و تیکت‌ها</h1></div><p className="muted">هر پاسخ مالک تیکت را به پاسخ‌دهنده منتقل می‌کند و تغییر در تاریخچه ثبت می‌شود.</p></div>
    <nav className="report-filter-tabs" aria-label="فیلتر تیکت‌ها">
      {FILTERS.map(([key, label]) => <Link key={key} href={`${basePath}?view=${key}`} className={filter === key ? "active" : ""}>{label}</Link>)}
    </nav>
    <div className="card list-card report-section">
      <div className="panel-heading"><h2 className="panel-title">صف پاسخ‌گویی</h2><span className="panel-caption">{toPersianDigits(String(visible.length))} تیکت</span></div>
      {visible.length === 0 ? <p className="empty-hint">تیکتی در این فیلتر وجود ندارد.</p> : <div className="table-wrap"><table><thead><tr><th>تیکت</th><th>مشتری</th><th>موضوع</th><th>سفارش</th><th>مالک فعلی</th><th>آخرین وضعیت SLA</th><th>ثبت</th></tr></thead><tbody>{visible.map((ticket) => <tr key={ticket.id}>
        <td><Link href={`${basePath}/${encodeURIComponent(ticket.id)}`} className="order-id">{ticket.code}</Link></td>
        <td>{ticket.customerName ?? ticket.customerCode}</td>
        <td>{ticket.subject}</td>
        <td>{ticket.orderNumber ?? "—"}</td>
        <td>{ticket.ownerStaffName ?? "بدون مالک"}</td>
        <td>{ticket.responseBreached ? <span className="badge badge-danger">پاسخ عقب‌افتاده</span> : isClosed(ticket) ? <span className="badge badge-success">بسته</span> : <span className="badge badge-info">تا {formatDateTime(ticket.nextResponseDueAt)}</span>}</td>
        <td>{formatDateTime(ticket.createdAt)}</td>
      </tr>)}</tbody></table></div>}
    </div>
  </div>;
}

function isClosed(ticket: SupportTicket): boolean {
  return ticket.status === "COMPLETED" || ticket.status === "FAILED" || ticket.status === "CANCELLED";
}
