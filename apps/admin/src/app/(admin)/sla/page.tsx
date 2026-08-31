import { requireRole } from "@/lib/session";
import { QUEUE_VIEW_ROLES } from "@/lib/api";
import { workItems } from "@/app/(operator)/_lib/work-items";
import { SlaPerformanceReport } from "@/components/sla-performance-report";

export default async function SlaPage() {
  await requireRole(QUEUE_VIEW_ROLES);
  const items = await workItems.list({ take: 200 });
  return <SlaPerformanceReport items={items} />;
}
