"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "@barat/ui";
import { toPersianDigits } from "@barat/ui";
import { InlineError, messageFor } from "../../../_components/error-notice";
import { fulfillment, type InternationalPaymentBrief } from "../../../_lib/fulfillment";

/** The password disappears on its own, so an unattended screen stops showing it. */
const REVEAL_VISIBLE_MS = 45_000;

/**
 * What the operator needs in order to pay a foreign invoice: where to pay, how
 * much, and — only when the customer supplied them — the credentials for their
 * own account on that site.
 *
 * The password is never part of this payload. `hasAccountPassword` says only
 * whether one exists; the plaintext arrives from a separate audited call and is
 * held in component state until the timer clears it.
 */
export function InternationalPaymentPanel({
  workItemId,
  brief,
  canOperate,
}: {
  workItemId: string;
  brief: InternationalPaymentBrief;
  canOperate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealing, setRevealing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const forget = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    setPassword(null);
    setReason("");
    setError(null);
  }, []);

  // The plaintext must not survive navigation away from the task either.
  useEffect(() => forget, [forget]);

  async function handleReveal() {
    setError(null);
    setRevealing(true);
    try {
      setPassword(await fulfillment.revealServiceAccountPassword(workItemId, reason.trim()));
      timer.current = setTimeout(forget, REVEAL_VISIBLE_MS);
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>پرداختی که باید انجام شود</h3>
        {brief.serviceNameFa ? <span>{brief.serviceNameFa}</span> : null}
      </div>

      <div className="details-grid">
        <div>
          <p className="detail-label">مبلغ قابل پرداخت</p>
          <p className="detail-value bp-ltr" style={{ fontSize: 20 }}>
            {brief.payableAmount ? `${brief.payableAmount} ${brief.payableCurrency}` : "—"}
          </p>
        </div>
        <div>
          <p className="detail-label">آدرس سایت</p>
          <p className="detail-value bp-ltr" style={{ overflowWrap: "anywhere" }}>
            {brief.siteUrl ? (
              <a href={brief.siteUrl} target="_blank" rel="noreferrer noopener">
                {brief.siteUrl}
              </a>
            ) : (
              "—"
            )}
          </p>
        </div>
      </div>

      <div className="kv-list" style={{ marginBlockStart: 14 }}>
        <div className="kv-row">
          <span>نام کاربری حساب مشتری</span>
          <span className="bp-ltr">{brief.accountUsername ?? "مشتری وارد نکرده است"}</span>
        </div>
        <div className="kv-row">
          <span>رمز عبور حساب مشتری</span>
          <span>{brief.hasAccountPassword ? "ذخیره شده (رمزنگاری‌شده)" : "مشتری وارد نکرده است"}</span>
        </div>
      </div>

      {brief.payableAmount === null ? (
        <p className="warning" style={{ marginBlockStart: 12 }}>
          مبلغ ارزی این سفارش در استعلام ثبت نشده است. پیش از پرداخت، مبلغ را با مدیر عملیات بررسی کنید.
        </p>
      ) : null}

      {brief.hasAccountPassword ? (
        <>
          <p className="warning" style={{ marginBlockStart: 12 }}>
            نمایش رمز عبور یک رخداد ثبت‌شده است: با هر بار مشاهده، یک ردیف SERVICE_ACCOUNT_PASSWORD_VIEWED به نام شما در
            گزارش رخدادها نوشته می‌شود. رمز را در هیچ یادداشت، پیام یا فایلی کپی نکنید.
          </p>
          <div className="save-row">
            <button
              type="button"
              className="secondary-btn"
              disabled={!canOperate}
              title={canOperate ? undefined : "برای مشاهدهٔ رمز عبور باید این کار روی میز شما باشد."}
              onClick={() => setOpen(true)}
            >
              نمایش رمز عبور (ثبت در گزارش رخدادها)
            </button>
          </div>
        </>
      ) : null}

      <Modal
        open={open}
        onClose={() => {
          setOpen(false);
          forget();
        }}
        title="نمایش رمز عبور حساب مشتری"
        description="این اقدام در گزارش رخدادها به نام شما ثبت می‌شود و قابل حذف نیست."
      >
        {password === null ? (
          <div style={{ display: "grid", gap: 12 }}>
            <label style={{ display: "grid", gap: 6, fontSize: 12 }}>
              دلیل مشاهده (الزامی)
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="مثلاً ورود به حساب مشتری برای تکمیل پرداخت اشتراک"
              />
            </label>
            <InlineError message={error} />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => {
                  setOpen(false);
                  forget();
                }}
              >
                انصراف
              </button>
              <button
                type="button"
                className="primary-btn"
                disabled={reason.trim().length < 3 || revealing}
                onClick={() => void handleReveal()}
              >
                {revealing ? "در حال نمایش…" : "ثبت در گزارش و نمایش رمز"}
              </button>
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <p className="warning" style={{ marginBlockStart: 0 }}>
              رمز پس از {toPersianDigits(REVEAL_VISIBLE_MS / 1000)} ثانیه به‌طور خودکار پنهان می‌شود.
            </p>
            <div>
              <p className="detail-label">رمز عبور</p>
              <p className="detail-value bp-ltr" style={{ fontSize: 18, letterSpacing: 1 }}>
                {password}
              </p>
            </div>
            <button type="button" className="primary-btn" onClick={forget}>
              پنهان کردن
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}
