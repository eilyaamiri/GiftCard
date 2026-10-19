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
  const [, startTransition] = useTransition();

  const isClosed = TERMINAL_STATUSES.includes(item.status);
  const isActive = ACTIVE_STATUSES.includes(item.status);
  const canClaim = item.status === "UNASSIGNED" && item.assignedToStaffId === null;
  const isSupplierFollowup = item.type === "SUPPLIER_FOLLOWUP";
  /* The convert-to-refund button only makes sense when the order is still in
   * REVIEW_REQUIRED — once it has left (refunded, fulfilled, etc.) the server
   * refuses the transition. We gate it on the active statuses here so the button
   * is not even shown on closed tasks, and the server still validates as the
   * real gate. */
  const canConvert = isMine && isActive && isSupplierFollowup;

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
    setBusy("convert");
    try {
      await workItems.convertToRefund(item.id, note.trim());
      setConverting(false);
      setConfirmedConvert(false);
      setNote("");
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
                    شارژ نتیجه نداد و امکان شارژ دستی هم نیست. سفارش به صف بازگشت وجه می‌رود.
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
        description="این اقدام سفارش را به صف بازگشت وجه می‌فرستد. تایید و یادداشت شما ثبت می‌شود."
      >
        <div style={{ display: "grid", gap: 12 }}>
          <p className="muted" style={{ margin: 0 }}>
            با تایید این اقدام، نوع کار از «پیگیری تأمین‌کننده» به «بررسی بازگشت‌وجه» تغییر می‌کند و سفارش
            به صف بازگشت وجه فرستاده می‌شود. یادداشت شما در کار ثبت می‌شود.
          </p>
          <Checkbox
            checked={confirmedConvert}
            onChange={(event) => setConfirmedConvert(event.target.checked)}
            label="تغییر به بازگشت وجه را تایید می‌کنم."
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
            {busy === "convert" ? "در حال تغییر…" : "تغییر به بازگشت وجه"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
