"use client";

import { useState } from "react";
import type { StaffRefundDto } from "@barat/contracts";
import { refundQueue } from "@/lib/refunds";
import { InlineError, messageFor } from "../../(operator)/_components/error-notice";

/**
 * The one action a refund is waiting for. The API decides who may take it —
 * the requester cannot approve their own refund — and its Persian message is
 * shown when it refuses.
 */
export function RefundActions({ refund }: { refund: StaffRefundDto }) {
  const [bankReference, setBankReference] = useState("");
  const [reason, setReason] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function run(action: () => Promise<unknown>) {
    setError(null);
    setSaving(true);
    try {
      await action();
      window.location.reload();
    } catch (caught) {
      setError(messageFor(caught));
      setSaving(false);
    }
  }

  if (refund.status === "APPROVED") {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => refundQueue.complete(refund.id, bankReference.trim()));
        }}
        style={{ display: "grid", gap: 8, minWidth: 220 }}
      >
        <input
          className="bp-ltr"
          value={bankReference}
          onChange={(event) => setBankReference(event.target.value)}
          placeholder="شمارهٔ پیگیری واریز بانکی"
          autoComplete="off"
          required
          minLength={4}
          maxLength={64}
        />
        <InlineError message={error} />
        <button className="primary-btn" type="submit" disabled={saving || bankReference.trim().length < 4}>
          {saving ? "در حال ثبت…" : "ثبت واریز به مشتری"}
        </button>
      </form>
    );
  }

  if (refund.status !== "REQUESTED") return <span className="muted">—</span>;

  return (
    <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
      {rejecting ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(() => refundQueue.reject(refund.id, reason.trim()));
          }}
          style={{ display: "grid", gap: 8 }}
        >
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="دلیل رد درخواست (حداقل ۱۰ نویسه)"
            required
            minLength={10}
            maxLength={500}
          />
          <button className="secondary-btn" type="submit" disabled={saving || reason.trim().length < 10}>
            {saving ? "در حال ثبت…" : "رد درخواست"}
          </button>
          <button type="button" className="secondary-btn" onClick={() => setRejecting(false)} disabled={saving}>
            انصراف
          </button>
        </form>
      ) : (
        <>
          <button className="primary-btn" type="button" disabled={saving} onClick={() => void run(() => refundQueue.approve(refund.id))}>
            {saving ? "در حال ثبت…" : "تأیید بازگشت وجه"}
          </button>
          <button className="secondary-btn" type="button" disabled={saving} onClick={() => setRejecting(true)}>
            رد…
          </button>
        </>
      )}
      <InlineError message={error} />
    </div>
  );
}
