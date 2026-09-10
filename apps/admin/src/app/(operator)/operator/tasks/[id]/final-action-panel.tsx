"use client";

import { useState } from "react";
import { Checkbox, Modal, toPersianDigits } from "@barat/ui";
import { parseDecimalText } from "@/lib/format-bps";
import { InlineError } from "../../../_components/error-notice";
import {
  SEND_BLOCKER_LABEL,
  type DeliveryOutcome,
  type FulfillmentWorkspace,
  type RecordActualCostInput,
} from "../../../_lib/fulfillment";

const CURRENCIES = ["USD", "EUR", "GBP", "TRY", "AED"];

/**
 * The final "send to customer" action, and everything still standing between the
 * operator and it.
 *
 * `canSend` is the server's answer, recomputed from the database on every read,
 * and the send endpoint re-derives it once more before dispatching. The
 * confirmation checkbox and the disabled button are here so an operator does not
 * send by reflex — they are not the gate.
 *
 * The cost entry lives in this card rather than above it because a blocker the
 * operator can clear is only useful next to the button it is blocking. It does
 * not weaken the gate: it fills in the one fact the gate asks for, and the
 * server re-derives the verdict afterwards. The code itself is typed into the
 * delivery-asset card, which is where an operator holding one looks first.
 */
export function FinalActionPanel({
  workspace,
  canOperate,
  onRecordCost,
  onSend,
  onRetry,
}: {
  workspace: FulfillmentWorkspace;
  canOperate: boolean;
  onRecordCost: (input: RecordActualCostInput) => Promise<void>;
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
  const codeAsset = workspace.assets.find(
    (asset) => asset.assetType === "CODE" || asset.assetType === "CODE_PIN",
  );
  /* An asset can be stored without a price — an admin filling a code request
   * enters the card, not the invoice — and `/supplier-result` refuses to run a
   * second time, so this is the only screen that can lift the blocker. */
  const costMissing =
    workspace.assets.length > 0 &&
    !workspace.checklist.isLocked &&
    workspace.sendBlockers.includes("ACTUAL_COST_MISSING");

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

      {codeAsset ? (
        <div className="kv-list" style={{ marginBlockEnd: 16 }}>
          <div className="kv-row">
            <span>کدی که ارسال می‌شود</span>
            <span className="bp-ltr">{codeAsset.maskedCode ?? "—"}</span>
          </div>
          <div className="kv-row">
            <span>پین</span>
            <span>{codeAsset.hasPin ? "ثبت شده و همراه کد ارسال می‌شود" : "این کارت پین ندارد"}</span>
          </div>
        </div>
      ) : null}

      {costMissing ? <ActualCostForm disabled={!canOperate} onSubmit={onRecordCost} /> : null}

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

/**
 * The price the supplier charged, for an order whose card is already stored.
 *
 * Records it once and then disappears: the endpoint refuses to overwrite an
 * amount already on file, because correcting a recorded cost is a finance
 * action rather than an operator one. A figure entered here is compared against
 * the quote exactly as one entered on the supplier-result form is, so it can
 * still raise the variance hold rather than slip past it.
 */
function ActualCostForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (input: RecordActualCostInput) => Promise<void>;
}) {
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    // Money never becomes a JS number: validated as text, sent as text.
    const parsed = parseDecimalText(cost);
    if (parsed === null) {
      setError("هزینهٔ واقعی باید یک عدد اعشاری معتبر باشد.");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({
        actualSupplierCost: parsed,
        actualSupplierCurrency: currency,
        ...(reference.trim() ? { supplierReference: reference.trim() } : {}),
      });
      setCost("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت هزینهٔ واقعی ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  const locked = disabled || saving;

  return (
    <section style={{ marginBlockEnd: 18, paddingBlockEnd: 18, borderBlockEnd: "1px solid var(--line)" }}>
      <div className="section-label">
        <h3 style={{ fontSize: 15 }}>هزینهٔ واقعی تأمین‌کننده</h3>
        <span>یک‌بار برای هر سفارش</span>
      </div>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        کد این سفارش ثبت شده اما مبلغی که بابت آن به تأمین‌کننده پرداخت شده هنوز ثبت نشده است. تا ثبت این مبلغ، ارسال
        برای مشتری باز نمی‌شود.
      </p>

      <div className="form-grid">
        <label>
          هزینهٔ واقعی تأمین‌کننده
          <input
            className="bp-ltr"
            inputMode="decimal"
            value={cost}
            disabled={locked}
            onChange={(event) => setCost(event.target.value)}
            placeholder="مثلاً 46.80"
          />
        </label>
        <label>
          واحد پول
          <select value={currency} disabled={locked} onChange={(event) => setCurrency(event.target.value)}>
            {CURRENCIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        {/* A card entered on a code request usually carries no reference on the
            fulfillment, which leaves the provider-reference row pending. Filling
            it here saves a trip back up to the checklist. */}
        <label>
          کد پیگیری تأمین‌کننده (اختیاری)
          <input
            className="bp-ltr"
            value={reference}
            disabled={locked}
            onChange={(event) => setReference(event.target.value)}
            placeholder="مثلاً TLO-9924123"
          />
        </label>
      </div>

      <div className="save-row">
        <button type="button" className="primary-btn" disabled={locked} onClick={() => void submit()}>
          {saving ? "در حال ثبت…" : "ثبت هزینهٔ واقعی"}
        </button>
      </div>

      <InlineError message={error} />
    </section>
  );
}
