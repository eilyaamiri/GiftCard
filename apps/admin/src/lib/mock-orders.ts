/** Placeholder order list/detail data — shaped like the future `/api/admin/orders` response. */
export interface OrderRow {
  id: string;
  number: string;
  customer: string;
  sku: string;
  status: "PAID" | "FULFILLING" | "DELIVERED" | "FAILED" | "REFUNDED" | "PENDING_PAYMENT";
  totalIrr: bigint;
  createdAt: string;
}

export const ORDER_STATUS_LABEL: Record<OrderRow["status"], string> = {
  PAID: "پرداخت‌شده",
  FULFILLING: "در حال تحویل",
  DELIVERED: "تحویل‌شده",
  FAILED: "ناموفق",
  REFUNDED: "بازگشت‌وجه",
  PENDING_PAYMENT: "در انتظار پرداخت",
};

export const ORDER_STATUS_BADGE: Record<OrderRow["status"], string> = {
  PAID: "badge-info",
  FULFILLING: "badge-wait",
  DELIVERED: "badge-success",
  FAILED: "badge-danger",
  REFUNDED: "badge-wait",
  PENDING_PAYMENT: "badge-wait",
};

export const mockOrders: OrderRow[] = [
  { id: "1", number: "BP-10432", customer: "امیر حسینی", sku: "Apple Gift Card 50 USD (US)", status: "FULFILLING", totalIrr: 96_500_000n, createdAt: "۱۴۰۵/۰۶/۰۸ ۱۰:۲۲" },
  { id: "2", number: "BP-10431", customer: "نیلوفر کریمی", sku: "Google Play 25 USD (TR)", status: "DELIVERED", totalIrr: 49_800_000n, createdAt: "۱۴۰۵/۰۶/۰۸ ۰۹:۵۸" },
  { id: "3", number: "BP-10430", customer: "رضا صادقی", sku: "ChatGPT Plus — یک ماهه", status: "PAID", totalIrr: 41_200_000n, createdAt: "۱۴۰۵/۰۶/۰۸ ۰۹:۴۰" },
  { id: "4", number: "BP-10429", customer: "الهام رستمی", sku: "PlayStation 50 USD (US)", status: "FAILED", totalIrr: 96_000_000n, createdAt: "۱۴۰۵/۰۶/۰۸ ۰۹:۲۲" },
  { id: "5", number: "BP-10428", customer: "کیان مرادی", sku: "Netflix 30 USD گیفت‌کارت", status: "REFUNDED", totalIrr: 58_100_000n, createdAt: "۱۴۰۵/۰۶/۰۸ ۰۸:۵۵" },
  { id: "6", number: "BP-10427", customer: "مهسا قاسمی", sku: "Xbox 20 USD (US)", status: "PENDING_PAYMENT", totalIrr: 38_600_000n, createdAt: "۱۴۰۵/۰۶/۰۸ ۰۸:۴۰" },
];

export function findOrder(id: string): OrderRow | undefined {
  return mockOrders.find((order) => order.id === id);
}
