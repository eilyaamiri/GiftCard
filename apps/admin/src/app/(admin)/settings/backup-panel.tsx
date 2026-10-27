"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { toPersianDigits } from "@barat/ui";
import { api } from "@/lib/api";
import {
  settingsBackupResponseSchema,
  settingsBackupRunListSchema,
  settingsBackupRunMutationSchema,
  settingsHostKeyScanSchema,
  settingsTestResultSchema,
  type SettingsBackup,
  type SettingsBackupRun,
  type SettingsLocalSnapshot,
  type SettingsTestResult,
} from "./settings-schema";

const MIN_PASSPHRASE_LENGTH = 16;
const RUN_POLL_MS = 4_000;

const STATUS_COPY: Record<SettingsBackupRun["status"], { label: string; badge: string }> = {
  RUNNING: { label: "در حال اجرا", badge: "badge-info" },
  SUCCEEDED: { label: "موفق", badge: "badge-success" },
  SKIPPED: { label: "بدون تغییر", badge: "badge-wait" },
  FAILED: { label: "ناموفق", badge: "badge-danger" },
};

const dateFormat = new Intl.DateTimeFormat("fa-IR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tehran",
});

/**
 * The off-host copy of the daily database backup.
 *
 * The server's own backup timer makes the dump; this panel decides where an
 * encrypted copy of it goes. The SSH key is best generated here, so its private
 * half never leaves the server: the admin only installs the public line on the
 * backup host. The archive passphrase is needed for any restore and is never
 * shown again after saving, so it has to be kept somewhere off this server.
 */
export function BackupPanel({
  initial,
  initialSnapshot,
  initialSnapshotError,
  initialRuns,
}: {
  initial: SettingsBackup;
  initialSnapshot: SettingsLocalSnapshot | null;
  initialSnapshotError: string | null;
  initialRuns: readonly SettingsBackupRun[];
}) {
  const [saved, setSaved] = useState(initial);
  const [enabled, setEnabled] = useState(initial.isEnabled);
  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(String(initial.port));
  const [username, setUsername] = useState(initial.username);
  const [remoteDirectory, setRemoteDirectory] = useState(initial.remoteDirectory);
  const [hostKeys, setHostKeys] = useState(initial.hostKeys);
  const [dailyAt, setDailyAt] = useState(initial.dailyAt);
  const [retention, setRetention] = useState(String(initial.retentionCount));
  const [passphrase, setPassphrase] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [showKeyPaste, setShowKeyPaste] = useState(false);
  const [scanned, setScanned] = useState<readonly { type: string; fingerprint: string; line: string }[] | null>(null);
  const [runs, setRuns] = useState([...initialRuns]);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<SettingsTestResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [testing, startTesting] = useTransition();

  const parsedPort = Number(port);
  const parsedRetention = Number(retention);
  const validPort = Number.isInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535;
  const validRetention = Number.isInteger(parsedRetention) && parsedRetention >= 1 && parsedRetention <= 365;
  const validTime = /^([01]\d|2[0-3]):[0-5]\d$/u.test(dailyAt);
  const validPassphrase = passphrase === "" || passphrase.length >= MIN_PASSPHRASE_LENGTH;
  const validDirectory = remoteDirectory.trim() === "" || /^\/?[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*\/?$/u.test(remoteDirectory.trim());

  const changed =
    enabled !== saved.isEnabled ||
    host !== saved.host ||
    parsedPort !== saved.port ||
    username !== saved.username ||
    remoteDirectory !== saved.remoteDirectory ||
    hostKeys.trim() !== saved.hostKeys.trim() ||
    dailyAt !== saved.dailyAt ||
    parsedRetention !== saved.retentionCount ||
    passphrase !== "" ||
    privateKey.trim() !== "";

  const running = runs.some((run) => run.status === "RUNNING");
  const busy = pending || testing;

  const refreshRuns = useCallback(async () => {
    try {
      const response = await api.get("/api/admin/settings/backup/runs", settingsBackupRunListSchema);
      setRuns(response.items);
    } catch {
      /* The next poll tries again; the table keeps its last good state. */
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void refreshRuns(), RUN_POLL_MS);
    return () => clearInterval(timer);
  }, [running, refreshRuns]);

  function touched() {
    setNotice(null);
    setError(null);
  }

  function connectionDraft() {
    return {
      host: host.trim(),
      port: parsedPort,
      username: username.trim(),
      remoteDirectory: remoteDirectory.trim(),
      hostKeys,
    };
  }

  function apply(next: SettingsBackup) {
    setSaved(next);
    setEnabled(next.isEnabled);
    setHostKeys(next.hostKeys);
  }

  function reset() {
    setEnabled(saved.isEnabled);
    setHost(saved.host);
    setPort(String(saved.port));
    setUsername(saved.username);
    setRemoteDirectory(saved.remoteDirectory);
    setHostKeys(saved.hostKeys);
    setDailyAt(saved.dailyAt);
    setRetention(String(saved.retentionCount));
    setPassphrase("");
    setPrivateKey("");
    setScanned(null);
    setError(null);
    setNotice(null);
  }

  function save() {
    if (!validPort || !validRetention || !validTime || !validPassphrase || !validDirectory) {
      setError("پورت، مسیر، ساعت، تعداد نسخه‌ها و رمز را بررسی کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.put(
          "/api/admin/settings/backup",
          {
            isEnabled: enabled,
            ...connectionDraft(),
            dailyAt,
            retentionCount: parsedRetention,
            ...(passphrase === "" ? {} : { archivePassphrase: passphrase }),
            ...(privateKey.trim() === "" ? {} : { privateKey }),
          },
          settingsBackupResponseSchema,
        );
        apply(response.settings);
        setPassphrase("");
        setPrivateKey("");
        setShowKeyPaste(false);
        setNotice(
          response.settings.isEnabled
            ? `تنظیمات ذخیره شد. نسخه‌ی پشتیبان هر روز ساعت ${toPersianDigits(response.settings.dailyAt)} به وقت تهران ارسال می‌شود.`
            : "تنظیمات ذخیره شد. ارسال خودکار هنوز غیرفعال است.",
        );
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function generateKey() {
    if (
      saved.hasPrivateKey &&
      !window.confirm("کلید فعلی جایگزین می‌شود و تا کلید عمومی جدید روی سرور پشتیبان قرار نگیرد، ارسال کار نمی‌کند. ادامه می‌دهید؟")
    ) {
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.post("/api/admin/settings/backup/ssh-key", {}, settingsBackupResponseSchema);
        setSaved((current) => ({ ...current, ...pick(response.settings) }));
        setNotice("کلید جدید ساخته شد. کلید عمومی را در فایل authorized_keys کاربر روی سرور پشتیبان قرار دهید.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function scanHostKeys() {
    startTesting(async () => {
      setTestResult(null);
      setScanned(null);
      try {
        const response = await api.post(
          "/api/admin/settings/backup/scan-host-keys",
          { host: host.trim(), port: parsedPort },
          settingsHostKeyScanSchema,
        );
        setScanned(response.keys);
      } catch (caught) {
        setTestResult({ success: false, message: errorMessage(caught), durationMs: 0 });
      }
    });
  }

  function testConnection() {
    startTesting(async () => {
      setTestResult(null);
      try {
        setTestResult(
          await api.post("/api/admin/settings/backup/test-connection", connectionDraft(), settingsTestResultSchema),
        );
      } catch (caught) {
        setTestResult({ success: false, message: errorMessage(caught), durationMs: 0 });
      }
    });
  }

  function runNow() {
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.post("/api/admin/settings/backup/runs", {}, settingsBackupRunMutationSchema);
        setRuns((current) => [response.run, ...current]);
        setNotice("ارسال نسخه‌ی پشتیبان شروع شد؛ نتیجه در جدول زیر نمایش داده می‌شود.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function generatePassphrase() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    setPassphrase(Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(""));
    touched();
  }

  return (
    <section className="settings-ledger" aria-labelledby="backup-title">
      <header className="settings-ledger-head">
        <div>
          <h2 id="backup-title">پشتیبان‌گیری خارج از سرور</h2>
          <p>ارسال خودکار و روزانه‌ی نسخه‌ی پشتیبان پایگاه داده، به‌صورت رمزنگاری‌شده، به یک سرور دیگر از طریق SFTP.</p>
        </div>
        <span className={`badge ${saved.isEnabled ? "badge-success" : "badge-danger"}`}>
          {saved.isEnabled ? `فعال — هر روز ${toPersianDigits(saved.dailyAt)}` : "غیرفعال"}
        </span>
      </header>

      {!saved.encryptionKeyConfigured ? (
        <p className="settings-context-note" role="alert">
          کلید <code dir="ltr">SETTINGS_ENCRYPTION_KEY</code> روی سرور تنظیم نشده است؛ تا آن تنظیم نشود کلید SSH و رمز
          نسخه‌ها ذخیره نمی‌شوند.
        </p>
      ) : null}

      <p className="settings-context-note">
        نسخه‌ی پشتیبان را خود سرور هر شب در <code dir="ltr">{saved.sourceDirectory}</code> می‌سازد؛ این بخش جدیدترین
        نسخه را با رمز زیر رمزنگاری می‌کند و به سرور پشتیبان می‌فرستد.{" "}
        {initialSnapshot !== null
          ? `جدیدترین نسخه‌ی محلی: ${dateFormat.format(new Date(initialSnapshot.createdAt))} (${formatBytes(initialSnapshot.sizeBytes)}).`
          : initialSnapshotError ?? "هنوز هیچ نسخه‌ی محلی کاملی پیدا نشده است."}
      </p>

      <article className={`settings-row${enabled ? " is-on" : " is-off"}`}>
        <div className="settings-row-main">
          <div className="settings-status-rail" aria-hidden="true" />
          <div className="settings-row-copy">
            <div className="settings-row-title">
              <strong>سرور پشتیبان</strong>
              {changed ? <span className="settings-unsaved">ذخیره‌نشده</span> : null}
            </div>
            <p>ورود فقط با کلید SSH انجام می‌شود و کلید سرور مقصد باید از پیش تأیید شده باشد.</p>
          </div>
          <label className="switch" aria-label="فعال بودن پشتیبان‌گیری خودکار">
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
            نشانی سرور (نام یا IP)
            <input
              value={host}
              dir="ltr"
              maxLength={253}
              placeholder="backup.example.com"
              autoComplete="off"
              onChange={(event) => {
                setHost(event.target.value);
                setScanned(null);
                touched();
              }}
              disabled={busy}
            />
          </label>
          <div className="form-grid">
            <label>
              پورت SSH
              <input
                type="number"
                min="1"
                max="65535"
                inputMode="numeric"
                dir="ltr"
                value={port}
                onChange={(event) => {
                  setPort(event.target.value);
                  touched();
                }}
                disabled={busy}
              />
            </label>
            <label>
              نام کاربری
              <input
                value={username}
                dir="ltr"
                maxLength={32}
                placeholder="backup"
                autoComplete="off"
                onChange={(event) => {
                  setUsername(event.target.value);
                  touched();
                }}
                disabled={busy}
              />
            </label>
          </div>

          <label>
            مسیر روی سرور پشتیبان
            <input
              value={remoteDirectory}
              dir="ltr"
              maxLength={200}
              placeholder="backups/centohub"
              onChange={(event) => {
                setRemoteDirectory(event.target.value);
                touched();
              }}
              disabled={busy}
            />
            <span className="settings-hint">نسبت به پوشه‌ی خانگی کاربر، یا مسیر کامل که با / شروع شود.</span>
          </label>
          <div className="form-grid">
            <label>
              ساعت ارسال روزانه (تهران)
              <input
                type="time"
                dir="ltr"
                value={dailyAt}
                onChange={(event) => {
                  setDailyAt(event.target.value);
                  touched();
                }}
                disabled={busy}
              />
              <span className="settings-hint">بعد از ساعت ساخت نسخه‌ی شبانه‌ی سرور (حدود ۰۳:۳۰).</span>
            </label>
            <label>
              تعداد نسخه‌های نگه‌داشته
              <input
                type="number"
                min="1"
                max="365"
                inputMode="numeric"
                dir="ltr"
                value={retention}
                onChange={(event) => {
                  setRetention(event.target.value);
                  touched();
                }}
                disabled={busy}
              />
            </label>
          </div>

          <label className="settings-full">
            کلید سرور پشتیبان (host key)
            <textarea
              value={hostKeys}
              dir="ltr"
              rows={2}
              placeholder="ssh-ed25519 AAAA…"
              onChange={(event) => {
                setHostKeys(event.target.value);
                touched();
              }}
              disabled={busy}
            />
            <span className="settings-hint">
              هویت سرور مقصد. با «دریافت کلید سرور» بخوانید و اثر انگشت آن را با خروجی{" "}
              <code dir="ltr">ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub</code> روی همان سرور مقایسه کنید.
              {saved.hostKeyFingerprints.length > 0
                ? ` ثبت‌شده: ${saved.hostKeyFingerprints.map((key) => key.fingerprint).join("، ")}`
                : ""}
            </span>
          </label>
          {scanned !== null ? (
            <div className="settings-full settings-create-card">
              <p className="settings-hint" style={{ marginTop: 0 }}>
                کلیدهایی که سرور اعلام کرد. فقط اگر اثر انگشت با سرور شما یکی است، تأیید کنید:
              </p>
              {scanned.map((key) => (
                <code key={key.line} className="settings-key" style={{ display: "block" }}>
                  {key.type} {key.fingerprint}
                </code>
              ))}
              <div className="settings-row-actions">
                <button
                  type="button"
                  className="primary-btn"
                  onClick={() => {
                    setHostKeys(scanned.map((key) => key.line).join("\n"));
                    setScanned(null);
                    touched();
                  }}
                >
                  تأیید و استفاده از این کلیدها
                </button>
              </div>
            </div>
          ) : null}

          <div className="settings-full">
            <label>
              کلید SSH این سرور (کلید عمومی)
              <textarea
                readOnly
                dir="ltr"
                rows={2}
                value={saved.publicKey ?? ""}
                placeholder="هنوز کلیدی ساخته نشده است."
              />
            </label>
            <p className="settings-hint">
              این خط را در <code dir="ltr">~/.ssh/authorized_keys</code> کاربر بالا روی سرور پشتیبان اضافه کنید. کلید
              خصوصی روی همین سرور و رمزنگاری‌شده می‌ماند.
            </p>
            <div className="settings-row-actions" style={{ justifyContent: "flex-start", marginTop: 8 }}>
              <button type="button" className="secondary-btn" onClick={generateKey} disabled={busy}>
                {saved.hasPrivateKey ? "ساخت کلید جدید" : "ساخت کلید SSH"}
              </button>
              {saved.publicKey !== null ? (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => void navigator.clipboard?.writeText(saved.publicKey ?? "")}
                >
                  کپی کلید عمومی
                </button>
              ) : null}
              <button type="button" className="secondary-btn" onClick={() => setShowKeyPaste((open) => !open)} disabled={busy}>
                {showKeyPaste ? "انصراف از واردکردن کلید" : "واردکردن کلید خصوصی موجود"}
              </button>
            </div>
            {showKeyPaste ? (
              <label style={{ marginTop: 10 }}>
                کلید خصوصی OpenSSH بدون رمز
                <textarea
                  dir="ltr"
                  rows={5}
                  value={privateKey}
                  placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(event) => {
                    setPrivateKey(event.target.value);
                    touched();
                  }}
                  disabled={busy}
                />
                <span className="settings-hint">پس از ذخیره دیگر نمایش داده نمی‌شود.</span>
              </label>
            ) : null}
          </div>

          <label className="settings-full">
            رمز رمزنگاری نسخه‌های پشتیبان
            <input
              type="text"
              dir="ltr"
              value={passphrase}
              maxLength={256}
              autoComplete="off"
              spellCheck={false}
              placeholder={
                saved.hasArchivePassphrase
                  ? "ذخیره شده — برای تغییر، رمز جدید را وارد کنید"
                  : `دست‌کم ${toPersianDigits(MIN_PASSPHRASE_LENGTH)} نویسه`
              }
              onChange={(event) => {
                setPassphrase(event.target.value);
                touched();
              }}
              disabled={busy}
            />
            <span className="settings-hint">
              بدون این رمز هیچ نسخه‌ای قابل بازیابی نیست و پس از ذخیره دوباره نمایش داده نمی‌شود؛ آن را جایی بیرون از
              این سرور نگه دارید. بازیابی: <code dir="ltr">node ops/backup-decrypt.mjs file.bkp database.dump</code>
            </span>
          </label>
          <div className="settings-row-actions settings-full" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="secondary-btn" onClick={generatePassphrase} disabled={busy}>
              ساخت رمز تصادفی
            </button>
          </div>

          <div className="settings-row-actions settings-full">
            <button type="button" className="secondary-btn" onClick={reset} disabled={!changed || busy}>
              بازنشانی
            </button>
            <button type="button" className="secondary-btn" onClick={scanHostKeys} disabled={busy || host.trim() === "" || !validPort}>
              دریافت کلید سرور
            </button>
            <button type="button" className="secondary-btn" onClick={testConnection} disabled={busy}>
              {testing ? "در حال آزمایش…" : "آزمایش اتصال"}
            </button>
            <button
              type="button"
              className="primary-btn"
              onClick={save}
              disabled={!changed || busy || !validPassphrase || !validDirectory}
            >
              {pending ? "در حال ثبت…" : "ثبت تنظیمات"}
            </button>
          </div>
        </div>

        {!validPassphrase ? (
          <p className="settings-message error" role="alert">
            رمز نسخه‌های پشتیبان باید دست‌کم {toPersianDigits(MIN_PASSPHRASE_LENGTH)} نویسه باشد.
          </p>
        ) : null}
        {!validDirectory ? (
          <p className="settings-message error" role="alert">
            مسیر فقط می‌تواند حروف انگلیسی، عدد، نقطه، خط تیره، زیرخط و / داشته باشد.
          </p>
        ) : null}
        {testResult ? (
          <p className={`settings-message ${testResult.success ? "success" : "error"}`} role="status">
            {testResult.message}
          </p>
        ) : null}
        {error ? <p className="settings-message error" role="alert">{error}</p> : null}
        {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
      </article>

      <article className="settings-row">
        <div className="settings-row-main">
          <div className="settings-row-copy">
            <div className="settings-row-title">
              <strong>تاریخچه‌ی ارسال‌ها</strong>
            </div>
            <p>هر اجرا، چه زمان‌بندی‌شده و چه دستی، اینجا ثبت می‌شود و هیچ‌وقت حذف نمی‌شود.</p>
          </div>
          <div className="settings-row-actions">
            <button type="button" className="secondary-btn" onClick={() => void refreshRuns()} disabled={busy}>
              به‌روزرسانی
            </button>
            <button type="button" className="primary-btn" onClick={runNow} disabled={busy || running || !saved.hasPrivateKey}>
              {running ? "در حال ارسال…" : "ارسال همین حالا"}
            </button>
          </div>
        </div>
        {runs.length === 0 ? (
          <p className="empty-hint">هنوز هیچ ارسالی انجام نشده است.</p>
        ) : (
          <div className="table-wrap" style={{ marginTop: 12 }}>
            <table>
              <thead>
                <tr>
                  <th>شروع</th>
                  <th>نوع</th>
                  <th>وضعیت</th>
                  <th>فایل</th>
                  <th>حجم</th>
                  <th>توضیح</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{dateFormat.format(new Date(run.startedAt))}</td>
                    <td>{run.trigger === "SCHEDULED" ? "خودکار" : "دستی"}</td>
                    <td>
                      <span className={`badge ${STATUS_COPY[run.status].badge}`}>{STATUS_COPY[run.status].label}</span>
                    </td>
                    <td dir="ltr" title={run.sha256 ?? undefined}>
                      {run.remoteFileName ?? "—"}
                    </td>
                    <td>{run.sizeBytes === null ? "—" : formatBytes(Number(run.sizeBytes))}</td>
                    <td style={{ whiteSpace: "normal", minWidth: 220 }}>{run.errorMessage ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  );
}

function pick(settings: SettingsBackup): Pick<SettingsBackup, "hasPrivateKey" | "publicKey" | "updatedAt"> {
  return { hasPrivateKey: settings.hasPrivateKey, publicKey: settings.publicKey, updatedAt: settings.updatedAt };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${toPersianDigits((bytes / 1024).toFixed(0))} کیلوبایت`;
  return `${toPersianDigits((bytes / (1024 * 1024)).toFixed(1))} مگابایت`;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "درخواست انجام نشد. دوباره تلاش کنید.";
}
