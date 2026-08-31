"use client";

import { useState } from "react";
import { Checkbox, Modal, toPersianDigits } from "@barat/ui";
import { InlineError } from "../../../_components/error-notice";
import { SEND_BLOCKER_LABEL, type DeliveryOutcome, type FulfillmentWorkspace } from "../../../_lib/fulfillment";

/**
 * The final "send to customer" action.
 *
 * `canSend` is the server's answer, recomputed from the database on every read,
 * and the send endpoint re-derives it once more before dispatching. The
 * confirmation checkbox and the disabled button are here so an operator does not
 * send by reflex — they are not the gate.
 */
export function FinalActionPanel({
  workspace,
  canOperate,
  onSend,
  onRetry,
}: {
  workspace: FulfillmentWorkspace;
  canOperate: boolean;
  onSend: () => Promise<DeliveryOutcome>;
  onRetry: () => Promise<DeliveryOutcome>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<DeliveryOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sent = workspace.assets.some((asset) => asset.status === "SENT");
  const failed = workspace.assets.some((asset) => asset.status === "DELIVERY_FAILED");

  async function dispatch(call: () => Promise<DeliveryOutcome>) {
    if (sending) return;
    setError(null);
    setSending(true);
    try {
      setOutcome(await call());
      setConfirming(false);
      setConfirmed(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ارسال ناموفق بود.");
    } finally {
      setSending(false);
    }
  }

  if (sent && outcome?.delivered !== false) {
    return (
      <div className="card workspace-card" style={{ background: "#eefaf4", borderColor: "#bfe8d4" }}>
        <div className="section-label">
          <h3 style={{ color: "#12835d" }}>ارسال شد</h3>
        </div>
        <p className="muted" style={{ marginBlockStart: 0 }}>
          تحویل برای مشتری ارسال شد و چک‌لیست قفل شده است. بازگشایی آن فقط از سوی مدیر عملیات ممکن است.
        </p>
      </div>
    );
  }

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>ارسال برای مشتری</h3>
      </div>

      {workspace.sendBlockers.length > 0 ? (
        <ul className="muted" style={{ marginBlockStart: 0, paddingInlineStart: 18, lineHeight: 2 }}>
          {workspace.sendBlockers.map((blocker) => (
            <li key={blocker}>{SEND_BLOCKER_LABEL[blocker]}</li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ marginBlockStart: 0 }}>
          سرویس تأیید کرده که همهٔ شرط‌های ارسال برقرار است. پیش از ارسال، مبلغ و منطقهٔ کارت را یک‌بار دیگر با سفارش
          مطابقت دهید.
        </p>
      )}

      {failed ? (
        <p className="warning">
          تلاش قبلی ارسال ناموفق بود. دارایی محفوظ است و چیزی از دست نرفته — دوباره تلاش کنید و هرگز کد تازه‌ای نخرید.
        </p>
      ) : null}

      <div className="save-row">
        {failed ? (
          <button type="button" className="primary-btn" disabled={!canOperate || sending} onClick={() => void dispatch(onRetry)}>
            {sending ? "در حال ارسال…" : "تلاش دوبارهٔ ارسال"}
          </button>
        ) : (
          <button
            type="button"
            className="primary-btn"
            disabled={!canOperate || !workspace.canSend || sending}
            onClick={() => setConfirming(true)}
          >
            ارسال برای مشتری
          </button>
        )}
      </div>

      {outcome && !outcome.delivered ? (
        <p className="warning">
          تلاش شمارهٔ {toPersianDigits(outcome.attemptNumber)} ناموفق بود
          {outcome.failureCode ? ` (${outcome.failureCode})` : ""}. دارایی همچنان محفوظ است.
        </p>
      ) : null}

      <InlineError message={error} />

      <Modal
        open={confirming}
        onClose={() => {
          setConfirming(false);
          setConfirmed(false);
        }}
        title="مرور نهایی پیش از ارسال"
        description="تحویل برای مشتری ارسال می‌شود و این اقدام قابل بازگشت نیست."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            پس از ارسال، چک‌لیست قفل می‌شود و ویرایش دارایی تحویل ممکن نخواهد بود.
          </p>
          <Checkbox
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            label="تأیید می‌کنم اطلاعات تحویل را با سفارش مطابقت داده‌ام و آمادهٔ ارسال برای مشتری است."
          />
        </div>
        <div style={{ marginBlockStart: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setConfirming(false);
              setConfirmed(false);
            }}
          >
            انصراف
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!confirmed || sending}
            onClick={() => void dispatch(onSend)}
          >
            {sending ? "در حال ارسال…" : "تأیید و ارسال"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
