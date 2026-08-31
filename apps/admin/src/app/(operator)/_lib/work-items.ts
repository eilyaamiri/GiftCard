import { z } from "zod";
import {
  isoDateTimeSchema,
  queueKeySchema,
  workItemStatusSchema,
  workItemTypeSchema,
  type QueueKey,
  type WorkItemStatus,
  type WorkItemType,
} from "@barat/contracts";
import { api } from "@/lib/api";

/**
 * Client for `/api/operator/work-items`.
 *
 * The shapes are pinned to `WorkItemSummary` in
 * `apps/api/src/modules/workitems/workitems.types.ts` — the API deliberately has
 * no `payload` passthrough, which is why nothing here can carry a gift-card code
 * by accident. Dates cross the wire as ISO strings.
 */

const nullableIsoDateTime = isoDateTimeSchema.nullable();

export const workItemSummarySchema = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  orderId: z.string().nullable(),
  customerId: z.string().nullable(),
  queueKey: queueKeySchema,
  type: workItemTypeSchema,
  status: workItemStatusSchema,
  priority: z.number().int(),
  assignedToStaffId: z.string().nullable(),
  assignedAt: nullableIsoDateTime,
  startedAt: nullableIsoDateTime,
  completedAt: nullableIsoDateTime,
  dueAt: nullableIsoDateTime,
  title: z.string(),
  description: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type WorkItemSummary = z.infer<typeof workItemSummarySchema>;

const workItemListSchema = z.object({ items: z.array(workItemSummarySchema) });
const myWorkItemListSchema = workItemListSchema.extend({ capacityUsed: z.number().int() });
const workItemEnvelopeSchema = z.object({ item: workItemSummarySchema });

export interface ListWorkItemsParams {
  readonly queueKey?: QueueKey;
  readonly status?: WorkItemStatus;
  readonly assignedToStaffId?: string;
  readonly take?: number;
}

function listPath(params: ListWorkItemsParams): string {
  const search = new URLSearchParams();
  if (params.queueKey) search.set("queueKey", params.queueKey);
  if (params.status) search.set("status", params.status);
  if (params.assignedToStaffId) search.set("assignedToStaffId", params.assignedToStaffId);
  search.set("take", String(params.take ?? 200));
  return `/api/operator/work-items?${search.toString()}`;
}

export const workItems = {
  list: async (params: ListWorkItemsParams = {}) =>
    (await api.get(listPath(params), workItemListSchema)).items,
  mine: () => api.get("/api/operator/work-items/mine", myWorkItemListSchema),
  getById: async (id: string) =>
    (await api.get(`/api/operator/work-items/${encodeURIComponent(id)}`, workItemEnvelopeSchema)).item,
  claim: async (id: string) =>
    (await api.post(`/api/operator/work-items/${encodeURIComponent(id)}/claim`, {}, workItemEnvelopeSchema)).item,
  start: async (id: string) =>
    (await api.post(`/api/operator/work-items/${encodeURIComponent(id)}/start`, {}, workItemEnvelopeSchema)).item,
  complete: async (id: string, resolutionNote?: string) =>
    (
      await api.post(
        `/api/operator/work-items/${encodeURIComponent(id)}/complete`,
        resolutionNote ? { resolutionNote } : {},
        workItemEnvelopeSchema,
      )
    ).item,
  fail: async (id: string, resolutionNote: string) =>
    (
      await api.post(
        `/api/operator/work-items/${encodeURIComponent(id)}/fail`,
        { resolutionNote },
        workItemEnvelopeSchema,
      )
    ).item,
};

/* ============================================================================
 * Vocabulary
 * ==========================================================================*/

export const WORK_ITEM_TYPE_LABEL: Record<WorkItemType, string> = {
  MANUAL_GIFT_CARD_FULFILLMENT: "تحویل دستی گیفت‌کارت",
  INTERNATIONAL_PAYMENT: "پرداخت بین‌المللی",
  CUSTOMER_INFORMATION: "اطلاعات مشتری",
  SUPPLIER_FOLLOWUP: "پیگیری تأمین‌کننده",
  UNKNOWN_OUTCOME: "نتیجهٔ نامشخص",
  REFUND_REVIEW: "بررسی بازگشت‌وجه",
  SUPPORT_REQUEST: "درخواست پشتیبانی",
};

export const WORK_ITEM_TYPE_ICON: Record<WorkItemType, string> = {
  MANUAL_GIFT_CARD_FULFILLMENT: "gift",
  INTERNATIONAL_PAYMENT: "credit-card",
  CUSTOMER_INFORMATION: "user-cog",
  SUPPLIER_FOLLOWUP: "truck",
  UNKNOWN_OUTCOME: "help-circle",
  REFUND_REVIEW: "rotate-ccw",
  SUPPORT_REQUEST: "message-square-warning",
};

export const WORK_ITEM_STATUS_LABEL: Record<WorkItemStatus, string> = {
  UNASSIGNED: "بدون تخصیص",
  ASSIGNED: "تخصیص‌یافته",
  IN_PROGRESS: "در حال انجام",
  WAITING_CUSTOMER: "در انتظار مشتری",
  WAITING_SUPPLIER: "در انتظار تأمین‌کننده",
  NEED_REVIEW: "نیازمند بررسی",
  COMPLETED: "تکمیل‌شده",
  FAILED: "ناموفق",
  CANCELLED: "لغوشده",
};

export const QUEUE_KEY_LABEL: Record<QueueKey, string> = {
  GIFT_CARD_MANUAL: "تحویل دستی گیفت‌کارت",
  SAAS_PAYMENT: "پرداخت SaaS",
  AI_TOOLS: "ابزارهای هوش مصنوعی",
  DOMAIN_HOSTING: "دامنه و هاستینگ",
  EXAM_PAYMENT: "پرداخت آزمون",
  SUPPLIER_ISSUE: "پیگیری تأمین‌کننده",
  CUSTOMER_INFO_REQUIRED: "نیازمند اطلاعات مشتری",
  UNKNOWN_OUTCOME: "نتیجهٔ نامشخص تأمین‌کننده",
  REFUND_REVIEW: "بررسی بازگشت‌وجه",
};

/** Mirrors ACTIVE_OPERATOR_STATUSES on the server: these occupy a desk slot. */
export const ACTIVE_STATUSES: readonly WorkItemStatus[] = [
  "ASSIGNED",
  "IN_PROGRESS",
  "WAITING_CUSTOMER",
  "WAITING_SUPPLIER",
  "NEED_REVIEW",
];

export const TERMINAL_STATUSES: readonly WorkItemStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];

/** Server-side cap in MAX_CONCURRENT_WORK_ITEMS_PER_OPERATOR. The API re-checks. */
export const MAX_CONCURRENT_WORK_ITEMS = 3;

export function isOverdue(item: WorkItemSummary, now: number = Date.now()): boolean {
  if (item.dueAt === null || TERMINAL_STATUSES.includes(item.status)) return false;
  return new Date(item.dueAt).getTime() < now;
}

/** Minutes until `dueAt`; negative once overdue, null when the item has no SLA. */
export function minutesUntilDue(item: WorkItemSummary, now: number = Date.now()): number | null {
  if (item.dueAt === null) return null;
  return Math.round((new Date(item.dueAt).getTime() - now) / 60_000);
}

/**
 * The queue orders by `priority` ASC, so a lower number is picked up sooner.
 * The default is 100; escalations are raised at 50.
 */
export function isHighPriority(item: WorkItemSummary): boolean {
  return item.priority < 100;
}
