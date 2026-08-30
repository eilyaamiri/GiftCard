"use client";

import { useState } from "react";
import { Modal, Checkbox } from "@barat/ui";
import { toPersianDigits } from "@barat/ui";
import type { ChecklistView } from "@/lib/mock-checklist";

export type SendState = "idle" | "confirming" | "sending" | "sent" | "failed";

/**
 * The final "send to customer" action. Stays disabled until the backend
 * reports the checklist is ready, requires an explicit confirmation
 * checkbox in a review modal, and cannot be double-submitted while sending.
 */
export function FinalActionPanel({
  checklist,
  onConfirmSend,
}: {
  checklist: ChecklistView;
  onConfirmSend: () => Promise<boolean>;
}) {
  const [state, setState] = useState<SendState>("idle");
  const [confirmed, setConfirmed] = useState(false);

  const disabled = !checklist.readyToSend || state === "sending";

  async function handleConfirm() {
    if (state === "sending") return; // hard guard against double submit
    setState("sending");
    const ok = await onConfirmSend();
    setState(ok ? "sent" : "failed");
  }

  if (state === "sent") {
    return (
      <div className="final-action" style={{ background: "#eefaf4", borderColor: "#bfe8d4" }}>
        <h3 style={{ color: "#12835d" }}>ارسال شد</h3>
        <p>گیفت‌کارت با موفقیت برای مشتری ارسال شد. این تسک تکمیل‌شده علامت خورد.</p>
      </div>
    );
  }

  if (state === "failed") {
    return (
      <div className="final-action" style={{ background: "#fff5f4", borderColor: "#f3caca" }}>
        <h3 style={{ color: "#b73a3a" }}>ارسال ناموفق بود</h3>
        <p>Gift Card محفوظ است — چیزی از دست نرفته. می‌توانید دوباره تلاش کنید یا برای بررسی بیشتر به سرپرست ارجاع دهید. هرگز کد جدید خریداری نکنید.</p>
        <div className="final-action-actions">
          <button type="button" className="deliver-btn" style={{ background: "var(--navy)" }} onClick={handleConfirm}>
            تلاش دوباره برای ارسال
          </button>
          <button type="button" className="secondary-btn">
            ارجاع به سرپرست
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="final-action">
      <h3>ارسال برای مشتری</h3>
      <p>
        {checklist.readyToSend
          ? "همهٔ موارد چک‌لیست تکمیل شده است. پیش از ارسال، اطلاعات را یک‌بار دیگر مرور کنید."
          : `${toPersianDigits(String(checklist.missingCount))} مورد دیگر باید تکمیل شود`}
      </p>
      <button type="button" className="deliver-btn" disabled={disabled} onClick={() => setState("confirming")}>
        ارسال برای مشتری
      </button>

      <Modal
        open={state === "confirming"}
        onClose={() => {
          setConfirmed(false);
          setState("idle");
        }}
        title="مرور نهایی پیش از ارسال"
        description="این کد گیفت‌کارت برای مشتری ارسال می‌شود و قابل بازگشت نیست."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            لطفاً برند، ریجن، مبلغ و کد ذخیره‌شده را یک‌بار دیگر با سفارش مطابقت دهید.
          </p>
          <Checkbox
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            label="تأیید می‌کنم اطلاعات گیفت‌کارت را بررسی کرده‌ام و آماده ارسال برای مشتری هستم."
          />
        </div>
        <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setConfirmed(false);
              setState("idle");
            }}
          >
            انصراف
          </button>
          <button type="button" className="primary-btn" disabled={!confirmed || state === "sending"} onClick={handleConfirm}>
            {state === "sending" ? "در حال ارسال..." : "تأیید و ارسال"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
