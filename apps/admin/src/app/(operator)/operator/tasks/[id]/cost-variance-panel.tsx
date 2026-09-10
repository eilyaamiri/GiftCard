"use client";

import { useState } from "react";
import { formatBps, formatDecimalString, formatSignedBps, parseDecimalText } from "@/lib/format-bps";
import { InlineError } from "../../../_components/error-notice";
import {
  COST_VARIANCE_REASON_LABEL,
  type CorrectActualCostInput,
  type CostVarianceAssessment,
  type RecordedSupplierCost,
} from "../../../_lib/fulfillment";

const CURRENCIES = ["USD", "EUR", "GBP", "TRY", "AED"];

/** Shared with the checklist row that links down to the correction control. */
export const SUPPLIER_COST_ANCHOR = "supplier-cost";

/**
 * Manager review of a supplier cost variance, and the correction of the figure
 * that produced it.
 *
 * An OPERATOR never sees either control, and that is only the cosmetic half:
 * the API refuses both calls for any role outside ADMIN / OPS_MANAGER /
 * MANAGEMENT, and refuses the approval again when the approver is the same
 * person who holds the delivery claim or recorded the cost. Approval is a second
 * pair of eyes by construction, not by convention.
 *
 * The two controls sit together because they answer the same question from
 * opposite sides: "was this really what we paid?" — yes, sign it off; no, fix it.
 *
 * What neither control does any more is release the card. An out-of-tolerance
 * spend is raised as its own review in the escalations queue and the delivery
 * goes ahead, so this panel is about our own books; the copy below must not
 * suggest a customer is waiting on it.
 */
export function CostVariancePanel({
  variance,
  recordedCost,
  canApprove,
  canCorrect,
  onApprove,
  onCorrect,
}: {
  variance: CostVarianceAssessment;
  recordedCost: RecordedSupplierCost | null;
  canApprove: boolean;
  canCorrect: boolean;
  onApprove: (reason: string) => Promise<void>;
  onCorrect: (input: CorrectActualCostInput) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleApprove() {
    setError(null);
    setSaving(true);
    try {
      await onApprove(reason.trim());
      setReason("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تأیید اختلاف هزینه ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  return (
    /* Anchor target: the checklist row for the recorded cost links here, because
     * that row is where an operator notices the figure is wrong. */
    <div className="card workspace-card" id={SUPPLIER_COST_ANCHOR}>
      <div className="section-label">
        <h3>اختلاف هزینهٔ تأمین‌کننده</h3>
        <span>{COST_VARIANCE_REASON_LABEL[variance.reason]}</span>
      </div>

      <div className="cost-panel">
        {recordedCost ? (
          <div className="cost-item">
            <span>هزینهٔ ثبت‌شده</span>
            <strong className="bp-ltr">
              {formatDecimalString(recordedCost.actualSupplierCost)} {recordedCost.actualSupplierCurrency ?? ""}
            </strong>
          </div>
        ) : null}
        <div className="cost-item">
          <span>اختلاف ثبت‌شده</span>
          <strong className={variance.requiresApproval ? "freshness-bad" : undefined}>
            {variance.varianceBps === null ? "—" : formatSignedBps(variance.varianceBps)}
          </strong>
        </div>
        <div className="cost-item">
          <span>حد مجاز</span>
          <strong>{formatBps(variance.toleranceBps)}</strong>
        </div>
        <div className="cost-item">
          <span>وضعیت</span>
          <strong>{variance.requiresApproval ? "در انتظار بررسی مدیر" : "بدون نیاز به بررسی"}</strong>
        </div>
      </div>

      {!variance.requiresApproval ? (
        <p className="muted">هزینهٔ ثبت‌شده در محدودهٔ مجاز است؛ بررسی جداگانه‌ای لازم نیست.</p>
      ) : canApprove ? (
        <>
          <p className="warning">
            این اختلاف برای بررسی شما در صف «پیگیری تأمین‌کننده» ثبت شده است. تحویل کد به مشتری متوقف نشده؛ اینجا فقط
            دربارهٔ مبلغ خرید تصمیم می‌گیرید: تأیید کنید یا مبلغ را اصلاح کنید. تأیید شما در گزارش رخدادها ثبت می‌شود و
            اگر هزینه را خودتان ثبت کرده باشید یا این کار روی میز شما باشد، سرویس تأیید شما را نمی‌پذیرد و مدیر دیگری
            باید آن را بررسی کند.
          </p>
          <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
            دلیل تأیید (الزامی)
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              placeholder="مثلاً افزایش نرخ تأمین‌کننده در زمان خرید"
            />
          </label>
          <div className="save-row">
            <button
              type="button"
              className="primary-btn"
              disabled={reason.trim().length < 3 || saving}
              onClick={() => void handleApprove()}
            >
              {saving ? "در حال ثبت…" : "تأیید اختلاف هزینه"}
            </button>
          </div>
          <InlineError message={error} />
        </>
      ) : (
        <p className="warning">
          این اختلاف از حد مجاز بیشتر است و برای بررسی مدیر عملیات یا مدیر سیستم ثبت شده است. ارسال کد برای مشتری به آن
          وابسته نیست و کار خود را ادامه دهید؛ بررسی مبلغ خرید بر عهدهٔ مدیر است.
        </p>
      )}

      {/* Offered whenever a figure is on file, not only when it is over
        * tolerance: a price typed too LOW is just as wrong, and — now that no
        * variance holds a delivery — nothing else would ever catch it. */}
      {canCorrect && recordedCost ? (
        <CorrectCostForm recordedCost={recordedCost} onSubmit={onCorrect} />
      ) : null}
    </div>
  );
}

/**
 * Replaces a supplier cost that was typed wrong.
 *
 * Deliberately not an inline edit on the figure above. A recorded spend is a
 * financial fact that a variance was measured against and possibly a manager
 * released, so replacing it is a distinct act with its own reason — the audit
 * row carries the old figure, the new one, and why.
 */
function CorrectCostForm({
  recordedCost,
  onSubmit,
}: {
  recordedCost: RecordedSupplierCost;
  onSubmit: (input: CorrectActualCostInput) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState(recordedCost.actualSupplierCurrency ?? "USD");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setCost("");
    setReason("");
    setError(null);
  }

  async function submit() {
    setError(null);
    // Money never becomes a JS number: validated as text, sent as text.
    const parsed = parseDecimalText(cost);
    if (parsed === null) {
      setError("مبلغ اصلاح‌شده باید یک عدد اعشاری معتبر باشد.");
      return;
    }

    setSaving(true);
    try {
      await onSubmit({ actualSupplierCost: parsed, actualSupplierCurrency: currency, reason: reason.trim() });
      close();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "اصلاح هزینه ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <div className="save-row">
        <button type="button" className="secondary-btn" onClick={() => setOpen(true)}>
          اصلاح مبلغ ثبت‌شده
        </button>
      </div>
    );
  }

  return (
    <section style={{ marginBlockStart: 18, paddingBlockStart: 18, borderBlockStart: "1px solid var(--line)" }}>
      <div className="section-label">
        <h3 style={{ fontSize: 15 }}>اصلاح هزینهٔ ثبت‌شده</h3>
        <span>فقط مدیر</span>
      </div>
      <p className="muted" style={{ marginBlockStart: 0 }}>
        مبلغ فعلی{" "}
        <span className="bp-ltr">
          {formatDecimalString(recordedCost.actualSupplierCost)} {recordedCost.actualSupplierCurrency ?? ""}
        </span>{" "}
        است. با ثبت مبلغ تازه، اختلاف هزینه دوباره محاسبه می‌شود و اگر قبلاً تأییدی روی مبلغ قبلی گرفته شده باشد، آن
        تأیید باطل می‌شود. مبلغ قبلی، مبلغ تازه و دلیل شما در گزارش رخدادها ثبت می‌شوند. این اصلاح فقط سند هزینهٔ ما را
        تغییر می‌دهد؛ کدی که برای مشتری ارسال شده دست‌نخورده می‌ماند.
      </p>

      <div className="form-grid">
        <label>
          مبلغ صحیح
          <input
            className="bp-ltr"
            inputMode="decimal"
            value={cost}
            disabled={saving}
            onChange={(event) => setCost(event.target.value)}
            placeholder="مثلاً 47.00"
          />
        </label>
        <label>
          واحد پول
          <select value={currency} disabled={saving} onChange={(event) => setCurrency(event.target.value)}>
            {CURRENCIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label style={{ display: "grid", gap: 6, fontSize: 12, marginBlockStart: 12 }}>
        دلیل اصلاح (الزامی)
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          disabled={saving}
          placeholder="مثلاً اپراتور جای اعشار را اشتباه وارد کرده بود"
        />
      </label>

      <div className="save-row">
        <button
          type="button"
          className="primary-btn"
          disabled={saving || reason.trim().length < 3 || cost.trim().length === 0}
          onClick={() => void submit()}
        >
          {saving ? "در حال ثبت…" : "ثبت مبلغ اصلاح‌شده"}
        </button>
        <button type="button" className="secondary-btn" disabled={saving} onClick={close}>
          انصراف
        </button>
      </div>

      <InlineError message={error} />
    </section>
  );
}
