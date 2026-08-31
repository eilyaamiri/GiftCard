import { requireRole } from "@/lib/session";
import { OPERATOR_ROLES } from "@/lib/api";
import { workItems } from "../../_lib/work-items";
import { SlaPerformanceReport } from "@/components/sla-performance-report";
import { TicketSlaReport } from "@/components/ticket-sla-report";
import { supportTickets } from "@/lib/support-tickets";

export default async function OperatorPerformancePage() {
  const staff = await requireRole(OPERATOR_ROLES);
  const [result, tickets] = await Promise.all([workItems.mine(), supportTickets.list()]);

  const myTickets = tickets.filter((ticket) => ticket.ownerStaffId === staff.id);
  const myName = myTickets.find((ticket) => ticket.ownerStaffName)?.ownerStaffName ?? null;

  return (
    <main className="page-shell">
      <div className="page-heading">
        <div>
          <p className="eyebrow">SLA · OPERATIONS QUALITY</p>
          <h1>عملکرد من و SLA</h1>
          <p className="muted">زمان انتظار، زمان انجام و وضعیت تعهدات کاری و پشتیبانی شما.</p>
        </div>
        <p className="muted">پنجرهٔ هشدار نزدیک SLA: ۳۰ دقیقه</p>
      </div>
      <SlaPerformanceReport items={result.items} personal embedded />
      <TicketSlaReport tickets={myTickets} personal operatorName={myName} />
    </main>
  );
}
