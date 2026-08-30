/** Placeholder payment data. No secrets (tokens, card PANs) are ever included — masked card only. */
export interface PaymentRow {
  id: string;
  orderNumber: string;
  authority: string;
  refId: string | null;
  providerAmount: string;
  providerAmountUnit: "IRR" | "IRT";
  maskedCard: string | null;
  status: "INITIATED" | "PENDING_CALLBACK" | "VERIFIED" | "FAILED" | "REFUNDED";
}

export const PAYMENT_STATUS_LABEL: Record<PaymentRow["status"], string> = {
  INITIATED: "آغازشده",
  PENDING_CALLBACK: "در انتظار بازگشت درگاه",
  VERIFIED: "تأییدشده",
  FAILED: "ناموفق",
  REFUNDED: "بازگشت‌وجه",
};

export const PAYMENT_STATUS_BADGE: Record<PaymentRow["status"], string> = {
  INITIATED: "badge-wait",
  PENDING_CALLBACK: "badge-wait",
  VERIFIED: "badge-success",
  FAILED: "badge-danger",
  REFUNDED: "badge-info",
};

export const mockPayments: PaymentRow[] = [
  { id: "1", orderNumber: "BP-10432", authority: "A00000000000000000000000000123456789", refId: "REF-9284123", providerAmount: "965000000", providerAmountUnit: "IRR", maskedCard: "6037-••••-••••-4521", status: "VERIFIED" },
  { id: "2", orderNumber: "BP-10430", authority: "A00000000000000000000000000123456700", refId: null, providerAmount: "412000000", providerAmountUnit: "IRR", maskedCard: null, status: "PENDING_CALLBACK" },
  { id: "3", orderNumber: "BP-10429", authority: "A00000000000000000000000000123456600", refId: null, providerAmount: "96000000", providerAmountUnit: "IRR", maskedCard: "5022-••••-••••-8842", status: "FAILED" },
  { id: "4", orderNumber: "BP-10428", authority: "A00000000000000000000000000123456500", refId: "REF-9284002", providerAmount: "581000000", providerAmountUnit: "IRR", maskedCard: "6274-••••-••••-1190", status: "REFUNDED" },
];

export function findPayment(id: string): PaymentRow | undefined {
  return mockPayments.find((payment) => payment.id === id);
}

export function formatExactAmount(value: string): string {
  if (!/^-?\d+(?:\.\d+)?$/u.test(value)) return "—";
  const [integer, fraction] = value.split(".");
  const integerText = BigInt(integer ?? "0").toLocaleString("fa-IR");
  if (fraction === undefined) return integerText;
  const fractionText = fraction.replace(/[0-9]/gu, (digit) => "۰۱۲۳۴۵۶۷۸۹"["0123456789".indexOf(digit)] ?? digit);
  return `${integerText}٫${fractionText}`;
}
