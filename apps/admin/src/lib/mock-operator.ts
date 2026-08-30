import type { WorkItemType } from "@barat/contracts";

/** Placeholder operator-desk data, shaped like the future `/api/operator/desk` response. */
export interface OperatorTaskSummary {
  id: string;
  type: WorkItemType;
  title: string;
  subtitle: string;
  queueLabel: string;
  priority: "HIGH" | "NORMAL";
  dueInMinutes: number | null;
  overdue: boolean;
  status: "UNASSIGNED" | "ASSIGNED" | "IN_PROGRESS" | "WAITING_CUSTOMER" | "WAITING_SUPPLIER" | "NEED_REVIEW" | "COMPLETED";
}

export const TASK_TYPE_LABEL: Record<WorkItemType, string> = {
  MANUAL_GIFT_CARD_FULFILLMENT: "تحویل دستی گیفت‌کارت",
  INTERNATIONAL_PAYMENT: "پرداخت بین‌المللی",
  CUSTOMER_INFORMATION: "اطلاعات مشتری",
  SUPPLIER_FOLLOWUP: "پیگیری تأمین‌کننده",
  UNKNOWN_OUTCOME: "نتیجهٔ نامشخص",
  REFUND_REVIEW: "بررسی بازگشت‌وجه",
  SUPPORT_REQUEST: "درخواست پشتیبانی",
};

export const TASK_TYPE_ICON: Record<WorkItemType, string> = {
  MANUAL_GIFT_CARD_FULFILLMENT: "gift",
  INTERNATIONAL_PAYMENT: "credit-card",
  CUSTOMER_INFORMATION: "user-cog",
  SUPPLIER_FOLLOWUP: "truck",
  UNKNOWN_OUTCOME: "help-circle",
  REFUND_REVIEW: "rotate-ccw",
  SUPPORT_REQUEST: "message-square-warning",
};

export const mockOperatorTasks: OperatorTaskSummary[] = [
  { id: "WI-77410", type: "MANUAL_GIFT_CARD_FULFILLMENT", title: "Apple Gift Card 50 USD (US)", subtitle: "سفارش BP-10432 · امیر حسینی", queueLabel: "تحویل دستی گیفت‌کارت", priority: "HIGH", dueInMinutes: 6, overdue: false, status: "IN_PROGRESS" },
  { id: "WI-77398", type: "SUPPLIER_FOLLOWUP", title: "تأخیر پاسخ Tillo برای سفارش BP-10388", subtitle: "بیش از ۴۰ دقیقه بدون پاسخ", queueLabel: "پیگیری تأمین‌کننده", priority: "HIGH", dueInMinutes: null, overdue: true, status: "WAITING_SUPPLIER" },
  { id: "WI-77405", type: "INTERNATIONAL_PAYMENT", title: "ChatGPT Plus — یک ماهه", subtitle: "سفارش BP-10430 · رضا صادقی", queueLabel: "پرداخت بین‌المللی", priority: "NORMAL", dueInMinutes: 22, overdue: false, status: "ASSIGNED" },
  { id: "WI-77401", type: "CUSTOMER_INFORMATION", title: "نیاز به آدرس ایمیل صحیح", subtitle: "سفارش BP-10427 · مهسا قاسمی", queueLabel: "اطلاعات مشتری", priority: "NORMAL", dueInMinutes: 118, overdue: false, status: "WAITING_CUSTOMER" },
  { id: "WI-77390", type: "UNKNOWN_OUTCOME", title: "خروجی نامشخص از Reloadly", subtitle: "سفارش BP-10375 · کیان مرادی", queueLabel: "نتیجهٔ نامشخص", priority: "HIGH", dueInMinutes: null, overdue: true, status: "NEED_REVIEW" },
  { id: "WI-77340", type: "MANUAL_GIFT_CARD_FULFILLMENT", title: "PlayStation 50 USD (US)", subtitle: "سفارش BP-10310 · نیلوفر کریمی", queueLabel: "تحویل دستی گیفت‌کارت", priority: "NORMAL", dueInMinutes: null, overdue: false, status: "COMPLETED" },
  { id: "WI-77299", type: "REFUND_REVIEW", title: "درخواست بازگشت‌وجه — کد ارسال نشد", subtitle: "سفارش BP-10250 · الهام رستمی", queueLabel: "بررسی بازگشت‌وجه", priority: "NORMAL", dueInMinutes: null, overdue: false, status: "COMPLETED" },
  { id: "WI-77280", type: "SUPPORT_REQUEST", title: "سؤال دربارهٔ زمان تحویل", subtitle: "سفارش BP-10201 · مهدی توکلی", queueLabel: "درخواست پشتیبانی", priority: "NORMAL", dueInMinutes: 40, overdue: false, status: "ASSIGNED" },
];

export function findOperatorTask(id: string): OperatorTaskSummary | undefined {
  return mockOperatorTasks.find((task) => task.id === id);
}
