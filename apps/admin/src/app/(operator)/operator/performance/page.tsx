import { requireRole } from "@/lib/session";
import { OPERATOR_ROLES } from "@/lib/api";
import { workItems } from "../../_lib/work-items";
import { SlaPerformanceReport } from "@/components/sla-performance-report";

export default async function OperatorPerformancePage() {
  await requireRole(OPERATOR_ROLES);
  const result = await workItems.mine();
  return <SlaPerformanceReport items={result.items} personal />;
}
