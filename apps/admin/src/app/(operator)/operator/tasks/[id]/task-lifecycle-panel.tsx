"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Checkbox, Modal } from "@barat/ui";
import { InlineError, messageFor } from "../../../_components/error-notice";
import {
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  WORK_ITEM_STATUS_LABEL,
  workItems,
  type WorkItemSummary,
} from "../../../_lib/work-items";

/** Parses a Toman string into a positive BigInt in IRR. Returns null if invalid. */
function parseTomanToIrr(toman: string): bigint | null {
  const cleaned = toman.replace(/[,،٬]/g, "").replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  if (!/^\d+$/.test(cleaned) || cleaned === "0") return null;
  return BigInt(cleaned) * 10n;
}

/**
 * Claim → start → complete/fail.
 *
 * Every transition is a server decision: a lost claim race, a full desk or a
 * status that no longer allows the transition all come back as an API error and
 * are shown verbatim. Nothing here is applied optimistically.
 */
export function TaskLifecyclePanel({ item, isMine }: { item: WorkItemSummary; isMine: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "claim" | "start" | "complete" | "fail" | "convert">(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [converting, setConverting] = useState(false);
  const [confirmedConvert, setConfirmedConvert] = useState(false);
  const [refundToman, setRefundToman] = useState("");
  /* Only asked for when the order already has a card (FUL-4); the API decides
   * whether one exists and refuses an operator, so this stays optional here. */
  const [cardDisposition, setCardDisposition] = useState<"" | "VOIDED" | "RESELLABLE">("");
  const [, startTransition] = useTransition();

  const isClosed = TERMINAL_STATUSES.includes(item.status);
  const isActive = ACTIVE_STATUSES.includes(item.status);
  const canClaim = item.status === "UNASSIGNED" && item.assignedToStaffId === null;
  /* The convert-to-refund button makes sense for SUPPLIER_FOLLOWUP (failed
   * top-ups) and MANUAL_GIFT_CARD_FULFILLMENT (gift cards with defective codes).
   * The server gate is the real check; this hides the button where it has no use. */
  const canConvert =
    isMine &&
    isActive &&
    (item.type === "SUPPLIER_FOLLOWUP" || item.type === "MANUAL_GIFT_CARD_FULFILLMENT");

  async function run(action: NonNullable<typeof busy>, call: () => Promise<unknown>) {
    setError(null);
    setBusy(action);
    try {
      await call();
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  async function convertToRefund() {
    setError(null);
    const amountIrr = parseTomanToIrr(refundToman);
    if (amountIrr === null) {
      setError("مبلغ بازگشت وجه نامعتبر است.");
      return;
    }
    setBusy("convert");
    try {
      await workItems.convertToRefund(
        item.id,
        note.trim(),
        amountIrr.toString(),
        cardDisposition === "" ? undefined : cardDisposition,
      );
      setConverting(false);
      setCardDisposition("");
      setConfirmedConvert(false);
      setNote("");
      setRefundToman("");
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>وضعیت کار</h3>
        <span>{WORK_ITEM_STATUS_LABEL[item.status]}</span>
      </div>

      {isClosed ? (
        <p className="muted" style={{ marginBlockStart: 0 }}>
          این کار بسته شده است و تغییر وضعیت دیگری نمی‌پذیرد.
        </p>
      ) : !isMine ? (
        <p className="muted" style={{ marginBlockStart: 0 }}>
          {canClaim
            ? "این کار هنوز برداشته نشده است. با برداشتن آن، مسئولیت تحویلش بر عهدهٔ شما خواهد بود."
            : "این کار روی میز اپراتور دیگری است. برای جابه‌جایی با سرپرست عملیات هماهنگ کنید."}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 10, marginBlockStart: 12 }}>
        {canClaim ? (
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null}
            onClick={() => void run("claim", () => workItems.claim(item.id))}
          >
            {busy === "claim" ? "در حال برداشتن…" : "برداشتن این کار"}
          </button>
        ) : null}

        {isMine && item.status === "ASSIGNED" ? (
          <button
            type="button"
            className="primary-btn"
            disabled={busy !== null}
            onClick={() => void run("start", () => workItems.start(item.id))}
          >
            {busy === "start" ? "در حال شروع…" : "شروع کار"}
          </button>
        ) : null}

        {isMine && isActive ? (
          <>
            <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
              یادداشت پایانی
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="خلاصهٔ نتیجه برای گزارش رخدادها"
                rows={3}
              />
            </label>
            <p className="warning" style={{ marginBlockStart: 0 }}>
              {item.type === "INTERNATIONAL_PAYMENT"
                ? "هرگز رمز عبور یا اطلاعات ورود حساب مشتری را در این یادداشت وارد نکنید."
                : "هرگز کد، پین یا لینک بازخرید گیفت‌کارت را در این یادداشت وارد نکنید."}
            </p>
            <button
              type="button"
              className="primary-btn"
              disabled={busy !== null}
              onClick={() => void run("complete", () => workItems.complete(item.id, note.trim() || undefined))}
            >
              {busy === "complete" ? "در حال بستن…" : "تکمیل کار"}
            </button>
            <button
              type="button"
              className="secondary-btn"
              disabled={busy !== null || note.trim().length === 0}
              title={note.trim().length === 0 ? "برای ناموفق کردن، ثبت دلیل الزامی است." : undefined}
              onClick={() => void run("fail", () => workItems.fail(item.id, note.trim()))}
            >
              {busy === "fail" ? "در حال ثبت…" : "ناموفق (با ذکر دلیل)"}
            </button>

            {canConvert ? (
              <>
                <div style={{ borderTop: "1px solid var(--line)", marginBlockStart: 4, paddingBlockStart: 12 }}>
                  <p className="muted" style={{ marginBlockEnd: 8 }}>
                    {item.type === "SUPPLIER_FOLLOWUP"
                      ? "شارژ نتیجه نداد و امکان شارژ دستی هم نیست. سفارش به صف بازگشت وجه می‌رود."
                      : "کد معیوب است یا تحویل ممکن نیست. سفارش به صف بازگشت وجه می‌رود."}
                  </p>
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={busy !== null || note.trim().length === 0}
                    onClick={() => setConverting(true)}
                  >
                    تغییر به بازگشت وجه
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : null}
      </div>

      <InlineError message={error} />

      <Modal
        open={converting}
        onClose={() => {
          setConverting(false);
          setConfirmedConvert(false);
        }}
        title="تغییر به بازگشت وجه"
        description="سفارش به صف بازگشت وجه فرستاده می‌شود و مبلغ ثبت می‌گردد."
      >
        <div style={{ display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            مبلغ بازگشت وجه (تومان)
            <input
              className="bp-ltr"
              inputMode="numeric"
              value={refundToman}
              onChange={(e) => setRefundToman(e.target.value)}
              placeholder="مثلاً ۲۰۵,۰۰۰"
              style={{ direction: "ltr", textAlign: "right" }}
            />
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            مبلغ واردشده از حساب واریزی کم می‌شود. در گزارش مالی یک سرفصل جداگانه نشان داده می‌شود.
          </p>
          <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
            وضعیت کارت خریداری‌شده (اگر برای این سفارش کارتی خریده شده)
            <select value={cardDisposition} onChange={(e) => setCardDisposition(e.target.value as typeof cardDisposition)}>
              <option value="">کارتی خریداری نشده است</option>
              <option value="VOIDED">کارت باطل می‌شود</option>
              <option value="RESELLABLE">کارت قابل فروش مجدد است</option>
            </select>
          </label>
          <p className="muted" style={{ margin: 0, fontSize: 12 }}>
            اگر کارت برای مشتری ارسال شده باشد، بازگشت وجه ممکن نیست. برای کارتی که خریده ولی ارسال نشده، فقط مدیر می‌تواند بازگشت وجه را ثبت کند.
          </p>
          <Checkbox
            checked={confirmedConvert}
            onChange={(event) => setConfirmedConvert(event.target.checked)}
            label="تغییر به بازگشت وجه را تأیید می‌کنم."
          />
        </div>
        <div style={{ marginBlockStart: 20, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              setConverting(false);
              setConfirmedConvert(false);
            }}
          >
            انصراف
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!confirmedConvert || busy === "convert"}
            onClick={() => void convertToRefund()}
          >
            {busy === "convert" ? "در حال ثبت…" : "ثبت بازگشت وجه"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
