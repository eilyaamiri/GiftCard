"use client";

import { useState, useTransition } from "react";
import { api } from "@/lib/api";
import {
  SMTP_PORTS,
  SMTP_SECURITY_MODES,
  settingsSmtpResponseSchema,
  settingsTestResultSchema,
  type SettingsSmtp,
  type SettingsTestResult,
} from "./settings-schema";

const SECURITY_LABELS: Record<SettingsSmtp["security"], string> = {
  STARTTLS: "STARTTLS (معمولاً پورت ۵۸۷)",
  SSL_TLS: "SSL/TLS (معمولاً پورت ۴۶۵)",
};

const DEFAULT_PORT: Record<SettingsSmtp["security"], number> = { STARTTLS: 587, SSL_TLS: 465 };

const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;

/**
 * The outbound e-mail account: one SMTP login used for login codes, order and
 * account notifications, and newsletters.
 *
 * The password field is write-only. It always starts empty; leaving it empty
 * keeps the stored password, typing replaces it. Both test buttons use what is
 * in the form right now, so a change can be proven before it is saved and
 * before it can break a customer's login e-mail.
 */
export function SmtpPanel({ initial }: { initial: SettingsSmtp }) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [security, setSecurity] = useState(initial.security);
  const [username, setUsername] = useState(initial.username);
  const [password, setPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [fromAddress, setFromAddress] = useState(initial.fromAddress);
  const [fromName, setFromName] = useState(initial.fromName);
  const [replyTo, setReplyTo] = useState(initial.replyTo);
  const [testRecipient, setTestRecipient] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SettingsTestResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const changed =
    enabled !== saved.isEnabled ||
    host !== saved.host ||
    port !== saved.port ||
    security !== saved.security ||
    username !== saved.username ||
    password !== "" ||
    clearPassword ||
    fromAddress !== saved.fromAddress ||
    fromName !== saved.fromName ||
    replyTo !== saved.replyTo;

  const fromValid = fromAddress.trim() === "" || EMAIL_PATTERN.test(fromAddress.trim());
  const replyValid = replyTo.trim() === "" || EMAIL_PATTERN.test(replyTo.trim());
  const willHavePassword = password !== "" || (saved.hasPassword && !clearPassword);
  const completeForEnable =
    host.trim() !== "" && fromAddress.trim() !== "" && (username.trim() === "" || willHavePassword);

  function touched() {
    setNotice(null);
    setError(null);
  }

  function draft() {
    return {
      host: host.trim(),
      port,
      security,
      username: username.trim(),
      password,
      fromAddress: fromAddress.trim(),
      fromName: fromName.trim(),
      replyTo: replyTo.trim(),
    };
  }

  function reset() {
    setEnabled(saved.isEnabled);
    setHost(saved.host);
    setPort(saved.port);
    setSecurity(saved.security);
    setUsername(saved.username);
    setPassword("");
    setClearPassword(false);
    setFromAddress(saved.fromAddress);
    setFromName(saved.fromName);
    setReplyTo(saved.replyTo);
    setError(null);
    setNotice(null);
  }

  function save() {
    if (!fromValid || !replyValid) {
      setError("آدرس‌های ایمیل را بررسی کنید.");
      return;
    }
    if (enabled && !completeForEnable) {
      setError("برای فعال‌کردن، نام سرور، آدرس فرستنده و (در صورت داشتن نام کاربری) گذرواژه لازم است.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.put(
          "/api/admin/settings/smtp",
          { isEnabled: enabled, ...draft(), clearPassword },
          settingsSmtpResponseSchema,
        );
        setSaved(response.settings);
        setPassword("");
        setClearPassword(false);
        setNotice(
          response.settings.isEnabled
            ? "تنظیمات ذخیره شد. ایمیل‌های سایت از همین حساب ارسال می‌شوند."
            : "تنظیمات ذخیره شد. ارسال ایمیل هنوز غیرفعال است.",
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function runTest(kind: "connection" | "email") {
    if (kind === "email" && !EMAIL_PATTERN.test(testRecipient.trim())) {
      setTestResult({ success: false, message: "آدرس گیرنده‌ی ایمیل آزمایشی معتبر نیست.", durationMs: 0 });
      return;
    }
    startTesting(async () => {
      setTestResult(null);
      try {
        const result =
          kind === "connection"
            ? await api.post("/api/admin/settings/smtp/test-connection", draft(), settingsTestResultSchema)
            : await api.post(
                "/api/admin/settings/smtp/test-email",
                { ...draft(), to: testRecipient.trim() },
                settingsTestResultSchema,
              );
        setTestResult(result);
      } catch (caught) {
        setTestResult({ success: false, message: errorMessage(caught), durationMs: 0 });
      }
    });
  }

  const busy = pending || testing;

  return (
    <section className="settings-ledger" aria-labelledby="smtp-title">
      <header className="settings-ledger-head">
        <div>
          <h2 id="smtp-title">ایمیل (SMTP)</h2>
          <p>حساب ایمیلی که کد ورود (OTP)، اطلاع‌رسانی سفارش‌ها و خبرنامه از آن ارسال می‌شود.</p>
        </div>
        <span className={`badge ${saved.isEnabled ? "badge-success" : "badge-danger"}`}>
          {saved.isEnabled ? "ارسال فعال" : "ارسال غیرفعال"}
        </span>
      </header>

      {!saved.encryptionKeyConfigured ? (
        <p className="settings-context-note" role="alert">
          کلید <code dir="ltr">SETTINGS_ENCRYPTION_KEY</code> روی سرور تنظیم نشده است؛ تا آن تنظیم نشود گذرواژه ذخیره
          نمی‌شود. آن را با <code dir="ltr">openssl rand -base64 32</code> بسازید و در فایل محیطی API قرار دهید.
        </p>
      ) : null}

      <p className="settings-context-note">
        تا وقتی این بخش غیرفعال است، ایمیلی واقعاً ارسال نمی‌شود. اتصال همیشه رمزنگاری‌شده است (STARTTLS یا SSL/TLS)
        و گذرواژه پس از ذخیره هرگز نمایش داده نمی‌شود. پیش از ذخیره، با «آزمایش اتصال» و «ارسال ایمیل آزمایشی» از
        درستی تنظیمات مطمئن شوید.
      </p>

      <article className={`settings-row${enabled ? " is-on" : " is-off"}`}>
        <div className="settings-row-main">
          <div className="settings-status-rail" aria-hidden="true" />
          <div className="settings-row-copy">
            <div className="settings-row-title">
              <strong>ارسال ایمیل از طریق SMTP</strong>
              {changed ? <span className="settings-unsaved">ذخیره‌نشده</span> : null}
            </div>
            <p>با روشن‌کردن این گزینه، همه‌ی ایمیل‌های سایت از این حساب ارسال می‌شوند.</p>
          </div>
          <label className="switch" aria-label="فعال بودن ارسال ایمیل">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => {
                setEnabled(event.target.checked);
                touched();
              }}
              disabled={busy}
            />
            <span className="slider" />
          </label>
        </div>

        <div className="settings-row-editor settings-queue-editor">
          <label>
            نشانی سرور SMTP
            <input
              value={host}
              dir="ltr"
              maxLength={253}
              placeholder="smtp.example.com"
              autoComplete="off"
              onChange={(event) => {
                setHost(event.target.value);
                touched();
              }}
              disabled={busy}
            />
          </label>
          <div className="form-grid">
            <label>
              رمزنگاری
              <select
                value={security}
                onChange={(event) => {
                  const next = event.target.value as SettingsSmtp["security"];
                  setSecurity(next);
                  if (port === DEFAULT_PORT[security]) setPort(DEFAULT_PORT[next]);
                  touched();
                }}
                disabled={busy}
              >
                {SMTP_SECURITY_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {SECURITY_LABELS[mode]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              پورت
              <select
                value={port}
                dir="ltr"
                onChange={(event) => {
                  setPort(Number(event.target.value));
                  touched();
                }}
                disabled={busy}
              >
                {SMTP_PORTS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            نام کاربری
            <input
              value={username}
              dir="ltr"
              maxLength={254}
              placeholder="no-reply@example.com"
              autoComplete="off"
              onChange={(event) => {
                setUsername(event.target.value);
                touched();
              }}
              disabled={busy}
            />
            <span className="settings-hint">اگر سرور بدون احراز هویت ارسال می‌کند خالی بگذارید.</span>
          </label>
          <div style={{ display: "grid", gap: 6 }}>
            <label>
              گذرواژه
              <input
                type="password"
                value={password}
                dir="ltr"
                maxLength={512}
                autoComplete="new-password"
                placeholder={saved.hasPassword ? "ذخیره شده — برای تغییر، گذرواژه‌ی جدید را وارد کنید" : ""}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (event.target.value !== "") setClearPassword(false);
                  touched();
                }}
                disabled={busy}
              />
            </label>
            {saved.hasPassword ? (
              <label className="settings-member" style={{ width: "fit-content" }}>
                <input
                  type="checkbox"
                  checked={clearPassword}
                  onChange={(event) => {
                    setClearPassword(event.target.checked);
                    if (event.target.checked) setPassword("");
                    touched();
                  }}
                  disabled={busy}
                />
                <small style={{ direction: "rtl" }}>حذف گذرواژه‌ی ذخیره‌شده</small>
              </label>
            ) : null}
          </div>

          <label>
            آدرس فرستنده (From)
            <input
              value={fromAddress}
              dir="ltr"
              maxLength={254}
              placeholder="no-reply@centohub.com"
              onChange={(event) => {
                setFromAddress(event.target.value);
                touched();
              }}
              disabled={busy}
            />
            <span className="settings-hint">بیشتر سرویس‌ها فقط آدرسی را می‌پذیرند که با نام کاربری یکی است.</span>
          </label>
          <label>
            نام فرستنده
            <input
              value={fromName}
              maxLength={80}
              placeholder="سنتو"
              onChange={(event) => {
                setFromName(event.target.value);
                touched();
              }}
              disabled={busy}
            />
          </label>

          <label>
            آدرس پاسخ (Reply-To، اختیاری)
            <input
              value={replyTo}
              dir="ltr"
              maxLength={254}
              placeholder="support@centohub.com"
              onChange={(event) => {
                setReplyTo(event.target.value);
                touched();
              }}
              disabled={busy}
            />
          </label>
          <div className="settings-row-actions" style={{ alignSelf: "end" }}>
            <button type="button" className="secondary-btn" onClick={reset} disabled={!changed || busy}>
              بازنشانی
            </button>
            <button type="button" className="secondary-btn" onClick={() => runTest("connection")} disabled={busy}>
              {testing ? "در حال آزمایش…" : "آزمایش اتصال"}
            </button>
            <button type="button" className="primary-btn" onClick={save} disabled={!changed || busy}>
              {pending ? "در حال ثبت…" : "ثبت تنظیمات"}
            </button>
          </div>
        </div>

        {!fromValid || !replyValid ? (
          <p className="settings-message error" role="alert">
            آدرس ایمیل وارد‌شده معتبر نیست.
          </p>
        ) : null}
        {error ? <p className="settings-message error" role="alert">{error}</p> : null}
        {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
      </article>

      <article className="settings-row">
        <div className="settings-row-copy">
          <div className="settings-row-title">
            <strong>ارسال ایمیل آزمایشی</strong>
          </div>
          <p>یک ایمیل واقعی با تنظیمات فعلی فرم (حتی پیش از ذخیره) به آدرس زیر فرستاده می‌شود.</p>
        </div>
        <div className="settings-row-editor">
          <label className="settings-reason-field" style={{ gridColumn: "1 / 3" }}>
            گیرنده
            <input
              value={testRecipient}
              dir="ltr"
              maxLength={254}
              placeholder="you@example.com"
              onChange={(event) => setTestRecipient(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className="settings-row-actions">
            <button type="button" className="primary-btn" onClick={() => runTest("email")} disabled={busy}>
              {testing ? "در حال ارسال…" : "ارسال ایمیل آزمایشی"}
            </button>
          </div>
        </div>
        {testResult ? (
          <p className={`settings-message ${testResult.success ? "success" : "error"}`} role="status">
            {testResult.message}
          </p>
        ) : null}
      </article>
    </section>
  );
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "درخواست انجام نشد. دوباره تلاش کنید.";
}
