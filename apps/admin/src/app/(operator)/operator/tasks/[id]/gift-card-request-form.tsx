"use client";

import { useState } from "react";
import { giftCardRequests, GIFT_CARD_REQUEST_KIND_LABEL } from "@/lib/gift-card-requests";
import { InlineError, messageFor } from "../../../_components/error-notice";

export function GiftCardRequestForm({ workItemId }: { workItemId: string }) {
  const [kind, setKind] = useState<"CODE" | "CODE_PIN">("CODE_PIN");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [requestNumber, setRequestNumber] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setState("saving");
    try {
      const request = await giftCardRequests.create({ workItemId, kind, reason: reason.trim() });
      setRequestNumber(request.requestNumber);
      setState("done");
    } catch (caught) {
      setError(messageFor(caught));
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <div className="success-box">
        درخواست <span className="bp-ltr">{requestNumber}</span> ثبت شد و در صف بررسی ادمین قرار گرفت.
      </div>
    );
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
      <label style={{ display: "grid", gap: 6 }}>
        نوع اطلاعات موردنیاز
        <select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
          {Object.entries(GIFT_CARD_REQUEST_KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </label>
      <label style={{ display: "grid", gap: 6 }}>
        دلیل درخواست
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} rows={3} placeholder="مثلاً کد تأمین‌کننده برای تکمیل سفارش لازم است" />
      </label>
      <InlineError message={error} />
      <button type="submit" className="primary-btn" disabled={state === "saving" || reason.trim().length < 3}>
        {state === "saving" ? "در حال ثبت…" : "ارسال درخواست به ادمین"}
      </button>
    </form>
  );
}
