import { requireRole } from "@/lib/session";
import { QUEUE_VIEW_ROLES } from "@/lib/api";
import { workItems } from "@/app/(operator)/_lib/work-items";
import { SlaPerformanceReport } from "@/components/sla-performance-report";
import { TicketSlaReport } from "@/components/ticket-sla-report";
import { supportTickets } from "@/lib/support-tickets";

export default async function SlaPage() {
  await requireRole(QUEUE_VIEW_ROLES);
  const [items, tickets] = await Promise.all([workItems.list({ take: 200 }), supportTickets.list()]);

  return (
    <main className="page-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SLA · OPERATIONS QUALITY</p>
          <h1>SLA و کیفیت عملیات</h1>
          <p className="muted">نمای واقعی تعهدات زمانی، صف‌های معوق و بهره‌وری عملیات و پشتیبانی.</p>
        </div>
        <p className="muted">پنجرهٔ هشدار نزدیک SLA: ۳۰ دقیقه</p>
      </div>
      <SlaPerformanceReport items={items} embedded />
      <TicketSlaReport tickets={tickets} />
    </main>
  );
}
