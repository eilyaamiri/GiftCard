import type { OrderStatus } from "@barat/contracts";

export type OrderStatusView = { readonly label: string; readonly tone: "ok" | "wait" | "info" | "danger" | "neutral" };

/** Persian customer-facing status vocabulary — do not change wording ad hoc. */
export const ORDER_STATUS_VIEW: Record<OrderStatus, OrderStatusView> = {
  DRAFT: { label: "در حال بررسی", tone: "neutral" },
  AWAITING_PAYMENT: { label: "در انتظار پرداخت", tone: "wait" },
  PAYMENT_PENDING: { label: "در حال بررسی", tone: "info" },
  PAID: { label: "پرداخت تأیید شد، سفارش در حال آماده‌سازی است", tone: "ok" },
  FULFILLMENT_PENDING: { label: "در انتظار تأمین‌کننده — نیازی به ثبت سفارش مجدد نیست", tone: "wait" },
  FULFILLING: { label: "در حال انجام", tone: "info" },
  FULFILLED: { label: "سفارش تکمیل شد", tone: "ok" },
  FAILED: { label: "ناموفق", tone: "danger" },
  REVIEW_REQUIRED: { label: "در حال بررسی", tone: "wait" },
  REFUND_PENDING: { label: "در حال بررسی بازگشت وجه", tone: "wait" },
  REFUNDED: { label: "وجه بازگشت داده شد", tone: "info" },
  CANCELLED: { label: "لغو شد", tone: "danger" },
};

export function orderStatusView(status: OrderStatus): OrderStatusView {
  return ORDER_STATUS_VIEW[status] ?? { label: "در حال بررسی", tone: "neutral" };
}
