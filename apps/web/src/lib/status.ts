import type { OrderStatus, PaymentStatus } from "@barat/contracts";
import type { AccountRefundStatus } from "@/lib/api";

export type StatusView = { readonly label: string; readonly tone: "ok" | "wait" | "info" | "danger" | "neutral" };

/** Persian customer-facing status vocabulary — do not change wording ad hoc. */
export const ORDER_STATUS_VIEW: Record<OrderStatus, StatusView> = {
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

export function orderStatusView(status: OrderStatus): StatusView {
  return ORDER_STATUS_VIEW[status] ?? { label: "در حال بررسی", tone: "neutral" };
}

/**
 * Persian payment vocabulary.
 *
 * Every state reads differently on purpose: a customer must never be able to
 * mistake a payment the gateway has merely accepted (`CREATED`, `REDIRECTED`,
 * `PENDING`) for one the server has verified (`PAID`). `UNKNOWN` deliberately
 * does not say "failed" — a gateway timeout leaves the outcome genuinely
 * undecided, and telling someone their money is gone before reconciliation has
 * run is worse than telling them we are still checking.
 */
export const PAYMENT_STATUS_VIEW: Record<PaymentStatus, StatusView> = {
  CREATED: { label: "پرداخت آغاز شد", tone: "neutral" },
  REDIRECTED: { label: "در انتظار تکمیل پرداخت در درگاه", tone: "wait" },
  PENDING: { label: "در انتظار تأیید بانک", tone: "wait" },
  PAID: { label: "پرداخت تأیید شد", tone: "ok" },
  FAILED: { label: "پرداخت ناموفق بود", tone: "danger" },
  CANCELLED: { label: "پرداخت لغو شد", tone: "danger" },
  UNKNOWN: { label: "نتیجهٔ پرداخت هنوز قطعی نیست", tone: "wait" },
  REFUND_PENDING: { label: "در حال بازگشت وجه", tone: "wait" },
  REFUNDED: { label: "وجه بازگشت داده شد", tone: "info" },
};

export function paymentStatusView(status: PaymentStatus): StatusView {
  return PAYMENT_STATUS_VIEW[status] ?? { label: "در حال بررسی", tone: "neutral" };
}

export const REFUND_STATUS_VIEW: Record<AccountRefundStatus, StatusView> = {
  REQUESTED: { label: "ثبت شد", tone: "wait" },
  APPROVED: { label: "تأیید شد", tone: "info" },
  PROCESSING: { label: "در حال انجام", tone: "info" },
  COMPLETED: { label: "بازگشت وجه انجام شد", tone: "ok" },
  REJECTED: { label: "رد شد", tone: "danger" },
  FAILED: { label: "ناموفق", tone: "danger" },
};

export function refundStatusView(status: AccountRefundStatus): StatusView {
  return REFUND_STATUS_VIEW[status] ?? { label: "در حال بررسی", tone: "neutral" };
}

/** WorkItem statuses, as a customer should read them for a support request. */
const SUPPORT_STATUS_VIEW: Record<string, StatusView> = {
  UNASSIGNED: { label: "در صف بررسی", tone: "wait" },
  ASSIGNED: { label: "در حال بررسی", tone: "info" },
  IN_PROGRESS: { label: "در حال بررسی", tone: "info" },
  WAITING_CUSTOMER: { label: "در انتظار پاسخ شما", tone: "wait" },
  WAITING_SUPPLIER: { label: "در حال پیگیری", tone: "wait" },
  NEED_REVIEW: { label: "در حال بررسی", tone: "info" },
  COMPLETED: { label: "بسته شد", tone: "ok" },
  FAILED: { label: "بسته شد", tone: "neutral" },
  CANCELLED: { label: "لغو شد", tone: "neutral" },
};

export function supportStatusView(status: string): StatusView {
  return SUPPORT_STATUS_VIEW[status] ?? { label: "در حال بررسی", tone: "neutral" };
}

/** Only `PAID` means the money is ours; everything else must not imply delivery. */
export function isPaymentSettled(status: PaymentStatus): boolean {
  return status === "PAID";
}

/**
 * Persian explanations for the normalised failure reasons. The raw provider
 * message is never surfaced — it can leak merchant configuration.
 */
export const PAYMENT_FAILURE_TEXT: Record<string, string> = {
  CUSTOMER_CANCELLED: "پرداخت در درگاه لغو شد. مبلغی از حساب شما کسر نشده است.",
  REQUEST_REJECTED: "درگاه پرداخت درخواست را نپذیرفت. لطفاً دوباره تلاش کنید.",
  VERIFY_FAILED: "تأیید پرداخت از سوی بانک انجام نشد.",
  INVALID_AUTHORITY: "این تراکنش نزد بانک شناسایی نشد.",
  AMOUNT_MISMATCH: "مبلغ تأییدشده با مبلغ سفارش یکسان نبود؛ سفارش متوقف شد.",
  PROVIDER_TIMEOUT: "پاسخ بانک دیر رسید. تا مشخص شدن نتیجه، وجه به‌صورت خودکار پیگیری می‌شود.",
  PROVIDER_NETWORK_ERROR: "ارتباط با درگاه پرداخت برقرار نشد.",
  PROVIDER_ALREADY_VERIFIED_LOCAL_STATE_MISMATCH: "این تراکنش در حال بررسی دستی است.",
  UNKNOWN_PROVIDER_RESPONSE: "پاسخ بانک قابل تفسیر نبود و در حال بررسی است.",
};

export function paymentFailureText(reason: string | null): string | null {
  return reason === null ? null : (PAYMENT_FAILURE_TEXT[reason] ?? "پرداخت کامل نشد.");
}
