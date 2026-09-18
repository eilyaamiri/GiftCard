import { describe, expect, it } from "vitest";

import {
  ORDER_STATUS_VIEW,
  PAYMENT_FAILURE_TEXT,
  PAYMENT_STATUS_VIEW,
  REFUND_STATUS_VIEW,
  isPaymentSettled,
  orderStatusView,
  paymentFailureText,
  paymentStatusView,
  refundStatusView,
  supportStatusView,
} from "./status";

describe("customer status vocabulary", () => {
  it("returns the approved customer copy for every order status", () => {
    for (const [status, view] of Object.entries(ORDER_STATUS_VIEW)) {
      expect(orderStatusView(status as keyof typeof ORDER_STATUS_VIEW)).toEqual(view);
    }
  });

  it("uses a neutral explanation for an unknown order state", () => {
    expect(orderStatusView("UNRECOGNIZED" as keyof typeof ORDER_STATUS_VIEW)).toEqual({
      label: "در حال بررسی",
      tone: "neutral",
    });
  });

  it("returns the approved customer copy for every payment status", () => {
    for (const [status, view] of Object.entries(PAYMENT_STATUS_VIEW)) {
      expect(paymentStatusView(status as keyof typeof PAYMENT_STATUS_VIEW)).toEqual(view);
    }
  });

  it("uses a neutral explanation for an unknown payment state", () => {
    expect(paymentStatusView("UNRECOGNIZED" as keyof typeof PAYMENT_STATUS_VIEW)).toEqual({
      label: "در حال بررسی",
      tone: "neutral",
    });
  });

  it("returns the approved customer copy for every refund status", () => {
    for (const [status, view] of Object.entries(REFUND_STATUS_VIEW)) {
      expect(refundStatusView(status as keyof typeof REFUND_STATUS_VIEW)).toEqual(view);
    }
  });

  it("uses a neutral explanation for an unknown refund state", () => {
    expect(refundStatusView("UNRECOGNIZED" as keyof typeof REFUND_STATUS_VIEW)).toEqual({
      label: "در حال بررسی",
      tone: "neutral",
    });
  });

  it("keeps support statuses in their intended customer-facing tone", () => {
    expect(supportStatusView("WAITING_CUSTOMER")).toEqual({ label: "در انتظار پاسخ شما", tone: "wait" });
    expect(supportStatusView("COMPLETED")).toEqual({ label: "بسته شد", tone: "ok" });
    expect(supportStatusView("UNRECOGNIZED")).toEqual({ label: "در حال بررسی", tone: "neutral" });
  });

  it("treats only verified payments as settled", () => {
    expect(isPaymentSettled("PAID")).toBe(true);
    expect(isPaymentSettled("PENDING")).toBe(false);
  });

  it("never exposes raw provider failure text", () => {
    for (const [reason, text] of Object.entries(PAYMENT_FAILURE_TEXT)) {
      expect(paymentFailureText(reason)).toBe(text);
    }
    expect(paymentFailureText(null)).toBeNull();
    expect(paymentFailureText("RAW_PROVIDER_ERROR")).toBe("پرداخت کامل نشد.");
  });
});
