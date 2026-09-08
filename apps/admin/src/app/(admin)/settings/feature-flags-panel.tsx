"use client";

import { useState, useTransition } from "react";
import { toPersianDigits } from "@barat/ui";
import { api } from "@/lib/api";
import {
  SETTINGS_REASON_MIN_LENGTH,
  settingsFeatureFlagMutationSchema,
  type SettingsFeatureFlag,
} from "./settings-schema";

const FLAG_LABELS: Record<SettingsFeatureFlag["key"], string> = {
  gift_cards_enabled: "خرید گیفت‌کارت",
  international_payments_enabled: "پرداخت بین‌المللی",
  manual_fulfillment_enabled: "تحویل دستی",
  supplier_api_enabled: "اتصال خودکار تأمین‌کننده",
  fx_auto_rate_enabled: "نرخ خودکار ارز",
  payment_gateway_enabled: "درگاه پرداخت",
  zarinpal_enabled: "درگاه زرین‌پال",
};

export function FeatureFlagsPanel({ initialFlags }: { initialFlags: readonly SettingsFeatureFlag[] }) {
  const [flags, setFlags] = useState([...initialFlags]);

  function replaceFlag(updated: SettingsFeatureFlag) {
    setFlags((current) => current.map((flag) => (flag.id === updated.id ? updated : flag)));
  }

  return (
    <section className="settings-ledger" aria-labelledby="feature-flags-title">
      <header className="settings-ledger-head">
        <div>
          <h2 id="feature-flags-title">پرچم‌های ویژگی</h2>
          <p>فعال‌سازی و دامنهٔ انتشار هر قابلیت را با دلیل ثبت‌شده تغییر دهید.</p>
        </div>
        <span className="settings-count">{toPersianDigits(flags.length)} پرچم</span>
      </header>

      <p className="settings-context-note">
        این مقادیر در تنظیمات سامانه و گزارش رخدادها ثبت می‌شوند. اثر هر پرچم فقط در ماژولی اعمال می‌شود که به آن متصل شده باشد.
      </p>

      <div className="settings-rows">
        {flags.map((flag) => (
          <FeatureFlagRow key={flag.id} flag={flag} onSaved={replaceFlag} />
        ))}
      </div>
    </section>
  );
}

function FeatureFlagRow({
  flag,
  onSaved,
}: {
  flag: SettingsFeatureFlag;
  onSaved: (flag: SettingsFeatureFlag) => void;
}) {
  const [enabled, setEnabled] = useState(flag.isEnabled);
  const [rollout, setRollout] = useState(formatRollout(flag.rolloutBps));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parsedPercent = Number(rollout);
  const rolloutBps = Number.isFinite(parsedPercent) ? Math.round(parsedPercent * 100) : -1;
  const changed = enabled !== flag.isEnabled || rolloutBps !== flag.rolloutBps;
  const validRollout = rollout.trim() !== "" && rolloutBps >= 0 && rolloutBps <= 10_000;
  const validReason = reason.trim().length >= SETTINGS_REASON_MIN_LENGTH;

  function reset() {
    setEnabled(flag.isEnabled);
    setRollout(formatRollout(flag.rolloutBps));
    setReason("");
    setError(null);
    setNotice(null);
  }

  function save() {
    if (!changed || !validRollout || !validReason) {
      setError("درصد انتشار معتبر و دلیل تغییر با حداقل ۸ نویسه وارد کنید.");
      return;
    }
    if (!window.confirm(`تغییرات «${FLAG_LABELS[flag.key]}» ثبت شود؟`)) return;

    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.patch(
          `/api/admin/settings/feature-flags/${encodeURIComponent(flag.key)}`,
          { isEnabled: enabled, rolloutBps, reason: reason.trim() },
          settingsFeatureFlagMutationSchema,
        );
        onSaved(response.flag);
        setEnabled(response.flag.isEnabled);
        setRollout(formatRollout(response.flag.rolloutBps));
        setReason("");
        setNotice("تغییر پرچم ثبت شد.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <article className={`settings-row${enabled ? " is-on" : " is-off"}`}>
      <div className="settings-row-main">
        <div className="settings-status-rail" aria-hidden="true" />
        <div className="settings-row-copy">
          <div className="settings-row-title">
            <strong>{FLAG_LABELS[flag.key]}</strong>
            <span className={`badge ${enabled ? "badge-success" : "badge-danger"}`}>
              {enabled ? "فعال" : "غیرفعال"}
            </span>
            {changed ? <span className="settings-unsaved">ذخیره‌نشده</span> : null}
          </div>
          <p>{flag.description ?? "توضیحی برای این پرچم ثبت نشده است."}</p>
          <code className="settings-key" dir="ltr">{flag.key}</code>
        </div>
        <label className="switch" aria-label={`وضعیت ${FLAG_LABELS[flag.key]}`}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              setNotice(null);
            }}
            disabled={pending}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="settings-row-editor">
        <label>
          دامنهٔ انتشار (درصد)
          <div className="settings-percent-input">
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              inputMode="decimal"
              dir="ltr"
              value={rollout}
              onChange={(event) => {
                setRollout(event.target.value);
                setNotice(null);
              }}
              disabled={pending}
            />
            <span>٪</span>
          </div>
        </label>
        <label className="settings-reason-field">
          دلیل تغییر
          <input
            value={reason}
            maxLength={500}
            placeholder="مثلاً: انتشار مرحله‌ای برای بررسی عملکرد"
            onChange={(event) => {
              setReason(event.target.value);
              setNotice(null);
            }}
            disabled={pending}
          />
        </label>
        <div className="settings-row-actions">
          <button type="button" className="secondary-btn" onClick={reset} disabled={!changed || pending}>
            بازنشانی
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={save}
            disabled={!changed || !validRollout || !validReason || pending}
          >
            {pending ? "در حال ثبت…" : "ثبت تغییر"}
          </button>
        </div>
      </div>
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
    </article>
  );
}

function formatRollout(value: number): string {
  return String(value / 100);
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "ثبت تغییر ممکن نشد. دوباره تلاش کنید.";
}
