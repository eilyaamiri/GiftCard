import { z } from "zod";
import {
  isoDateTimeSchema,
  listRefundsResponseSchema,
  staffRefundDtoSchema,
  type RefundStatus,
  type StaffRefundDto,
  type StaffRole,
} from "@barat/contracts";
import { api } from "@/lib/api";

/**
 * Who works the refund queue. Mirrors `@Roles` on the API's RefundsController:
 * returning money is a finance decision, not an operator's.
 */
export const REFUND_QUEUE_ROLES = ["ADMIN", "FINANCE"] as const satisfies readonly StaffRole[];

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  REQUESTED: "در انتظار تأیید",
  APPROVED: "تأییدشده — در انتظار واریز",
  PROCESSING: "در حال پردازش",
  COMPLETED: "بازگردانده شد",
  REJECTED: "ردشده",
  FAILED: "ناموفق",
};

/** Reasons the payments module files on its own, in words finance reads. */
export const REFUND_REASON_LABEL: Record<string, string> = {
  DUPLICATE_PAYMENT_FOR_ORDER: "پرداخت تکراری برای سفارشی که پیش‌تر پرداخت شده بود",
  PAYMENT_FOR_CLOSED_ORDER: "پرداخت برای سفارش بسته‌شده",
};

/** Client for the finance refund queue, `/api/admin/refunds`. */
export const refundQueue = {
  list: async (status?: RefundStatus): Promise<StaffRefundDto[]> =>
    (
      await api.get(
        `/api/admin/refunds${status ? `?status=${encodeURIComponent(status)}` : ""}`,
        listRefundsResponseSchema,
      )
    ).items,
  approve: (id: string) =>
    api.post(`/api/admin/refunds/${encodeURIComponent(id)}/approve`, {}, staffRefundDtoSchema),
  complete: (id: string, bankReference: string) =>
    api.post(`/api/admin/refunds/${encodeURIComponent(id)}/complete`, { bankReference }, staffRefundDtoSchema),
  reject: (id: string, reason: string) =>
    api.post(`/api/admin/refunds/${encodeURIComponent(id)}/reject`, { reason }, staffRefundDtoSchema),
};

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
