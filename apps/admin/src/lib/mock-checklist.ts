import type { ChecklistItemType, ChecklistItemStatus, ChecklistStatus } from "@barat/contracts";

/**
 * Placeholder checklist state shaped like the future
 * `GET /api/operator/work-items/:id/checklist` response. In the real
 * implementation this is refetched after every mutation (item toggle, gift
 * card save, provider purchase, manager approval) — there is no local fake
 * checklist state once that endpoint exists. `useTaskChecklist` below stands
 * in for that refetch-on-mutation contract so the workspace components can
 * be written against the final shape now.
 */
export interface ChecklistItemView {
  id: string;
  type: ChecklistItemType;
  label: string;
  status: ChecklistItemStatus;
  blockingReason: string | null;
}

export interface ChecklistView {
  status: ChecklistStatus;
  passed: number;
  total: number;
  items: ChecklistItemView[];
  readyToSend: boolean;
  missingCount: number;
}

const initialChecklist: ChecklistItemView[] = [
  { id: "c1", type: "SYSTEM_VERIFIED", label: "پرداخت سفارش تأیید شده است", status: "PASSED", blockingReason: null },
  { id: "c2", type: "SYSTEM_VERIFIED", label: "Quote با مبلغ سفارش مطابقت دارد", status: "PASSED", blockingReason: null },
  { id: "c3", type: "BOOLEAN", label: "برند، ریجن و مبلغ گیفت‌کارت با سفارش مطابقت دارد", status: "PASSED", blockingReason: null },
  { id: "c4", type: "REQUIRED_FIELD", label: "خرید از تأمین‌کننده ثبت شد (Provider order ref)", status: "PASSED", blockingReason: null },
  { id: "c5", type: "REQUIRED_FIELD", label: "هزینهٔ واقعی تأمین‌کننده ثبت شد", status: "PASSED", blockingReason: null },
  { id: "c6", type: "SYSTEM_VERIFIED", label: "اختلاف هزینه در محدودهٔ مجاز است", status: "PASSED", blockingReason: null },
  { id: "c7", type: "REQUIRED_FIELD", label: "کد گیفت‌کارت وارد و ذخیره شد", status: "PENDING", blockingReason: "کد گیفت‌کارت هنوز ذخیره نشده است" },
  { id: "c8", type: "REQUIRED_FIELD", label: "پین (در صورت نیاز) وارد و ذخیره شد", status: "PENDING", blockingReason: "پین گیفت‌کارت هنوز ذخیره نشده است" },
  { id: "c9", type: "REQUIRED_FIELD", label: "شمارهٔ سریال ثبت شد", status: "PASSED", blockingReason: null },
  { id: "c10", type: "REQUIRED_FIELD", label: "تاریخ انقضا (در صورت وجود) ثبت شد", status: "NOT_APPLICABLE", blockingReason: null },
  { id: "c11", type: "MANAGER_APPROVAL", label: "تأیید مدیر برای اختلاف هزینه (در صورت نیاز)", status: "NOT_APPLICABLE", blockingReason: null },
  { id: "c12", type: "BOOLEAN", label: "یادداشت داخلی بدون کد یا اطلاعات حساس ثبت شده", status: "PASSED", blockingReason: null },
  { id: "c13", type: "SYSTEM_VERIFIED", label: "دارایی گیفت‌کارت رمزنگاری و ذخیره شده است", status: "PENDING", blockingReason: "منتظر ذخیرهٔ کد و پین" },
];

function computeView(items: ChecklistItemView[]): ChecklistView {
  // The progress indicator reports the complete backend template (including
  // items that are not applicable); N/A rows count as satisfied. Gating still
  // uses only relevant rows, so an N/A item can never make delivery eligible.
  const relevant = items.filter((i) => i.status !== "NOT_APPLICABLE");
  const passed = items.filter((i) => i.status === "PASSED" || i.status === "NOT_APPLICABLE").length;
  const missingCount = relevant.filter((i) => i.status !== "PASSED").length;
  const readyToSend = missingCount === 0;
  const status: ChecklistStatus = readyToSend ? "READY_FOR_REVIEW" : relevant.some((i) => i.status === "FAILED") ? "BLOCKED" : "INCOMPLETE";
  return { status, passed, total: items.length, items, readyToSend, missingCount };
}

/**
 * Simulated backend store, keyed by work item id. Stands in for the real API
 * + react-query cache; the *shape* of `refetch` mirrors what the real hook
 * will do (mutate on the server, then reload the checklist).
 */
const store = new Map<string, ChecklistItemView[]>();

export function getChecklist(taskId: string): ChecklistView {
  let items = store.get(taskId);
  if (!items) {
    items = initialChecklist.map((i) => ({ ...i }));
    store.set(taskId, items);
  }
  return computeView(items);
}

export function markItemPassed(taskId: string, itemId: string): ChecklistView {
  const items = store.get(taskId) ?? initialChecklist.map((i) => ({ ...i }));
  const next = items.map((item) => (item.id === itemId ? { ...item, status: "PASSED" as ChecklistItemStatus, blockingReason: null } : item));
  store.set(taskId, next);
  return computeView(next);
}
