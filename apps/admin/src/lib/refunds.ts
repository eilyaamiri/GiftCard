import { z } from "zod";
import { isoDateTimeSchema } from "@barat/contracts";
import { api } from "@/lib/api";

/**
 * Client for `GET /api/admin/finance/refunds`.
 *
 * Money crosses the wire as a decimal string and stays one until it is summed
 * as BigInt here. It never becomes a JS number: 2^53 rial is about 9×10^15,
 * which a year of trading would pass, and a float total on a finance report is
 * the exact failure AGENTS.md rule 2 exists to prevent.
 */

const refundRecordSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  amountIrr: z.string().regex(/^\d+$/u),
  status: z.string().min(1),
  reason: z.string(),
  requestedAt: isoDateTimeSchema,
  requestedBy: z.string().nullable(),
});
export type RefundRecord = z.infer<typeof refundRecordSchema>;

const refundListSchema = z.object({
  refunds: z.array(refundRecordSchema),
  totalIrr: z.string().regex(/^\d+$/u),
  count: z.number().int(),
});

export interface RefundSummary {
  readonly refunds: readonly RefundRecord[];
  readonly totalIrr: bigint;
  readonly count: number;
}

/**
 * Reads the refunds requested within an inclusive date range.
 *
 * `from`/`to` are plain calendar dates; the server cuts the day at Tehran
 * midnight, the same boundary `readReportFilters` uses, so the refund total
 * covers exactly the orders shown beside it.
 */
export async function fetchRefunds(from: string, to: string): Promise<RefundSummary> {
  const search = new URLSearchParams({ from, to });
  const payload = await api.get(`/api/admin/finance/refunds?${search.toString()}`, refundListSchema);
  return {
    refunds: payload.refunds,
    totalIrr: BigInt(payload.totalIrr),
    count: payload.count,
  };
}

/**
 * Refund statuses that have actually moved money out, or committed to.
 *
 * A REJECTED refund is a request someone turned down — counting it would
 * understate revenue for a refund that never happened.
 */
const COUNTED_STATUSES: ReadonlySet<string> = new Set([
  "REQUESTED",
  "APPROVED",
  "PROCESSING",
  "COMPLETED",
]);

/** The deduction to apply to GMV: everything except rejected and failed. */
export function deductibleTotal(refunds: readonly RefundRecord[]): bigint {
  return refunds.reduce(
    (sum, refund) => (COUNTED_STATUSES.has(refund.status) ? sum + BigInt(refund.amountIrr) : sum),
    0n,
  );
}
