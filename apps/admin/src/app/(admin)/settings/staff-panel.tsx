"use client";

import { useMemo, useState, useTransition } from "react";
import type { StaffRole } from "@barat/contracts";
import { STAFF_ROLE_VALUES } from "@barat/contracts";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { STAFF_ROLE_LABELS, api } from "@/lib/api";
import {
  SETTINGS_REASON_MIN_LENGTH,
  settingsStaffDeleteSchema,
  settingsStaffMutationSchema,
  type SettingsStaff,
} from "./settings-schema";

type Filter = "ALL" | "ACTIVE" | "INACTIVE";

const FILTER_LABELS: Record<Filter, string> = {
  ALL: "همه",
  ACTIVE: "فعال",
  INACTIVE: "غیرفعال",
};

export function StaffPanel({
  initialStaff,
  currentStaffId,
}: {
  initialStaff: readonly SettingsStaff[];
  currentStaffId: string;
}) {
  const [staff, setStaff] = useState([...initialStaff]);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [creating, setCreating] = useState(false);

  const visible = useMemo(
    () =>
      staff.filter((member) =>
        filter === "ALL" ? true : filter === "ACTIVE" ? member.isActive : !member.isActive,
      ),
    [staff, filter],
  );
  const activeCount = staff.filter((member) => member.isActive).length;
  const activeAdmins = staff.filter((member) => member.isActive && member.role === "ADMIN").length;

  return (
    <section className="settings-ledger" aria-labelledby="staff-title">
      <header className="settings-ledger-head">
        <div>
          <h2 id="staff-title">کارکنان</h2>
          <p>
            {toPersianDigits(activeCount)} حساب فعال از {toPersianDigits(staff.length)} حساب ثبت‌شده
          </p>
        </div>
        <button type="button" className="primary-btn" onClick={() => setCreating((open) => !open)}>
          {creating ? "بستن فرم" : "افزودن کارمند"}
        </button>
      </header>

      {creating ? (
        <CreateStaffForm
          onCreated={(created) => {
            setStaff((current) => [created, ...current]);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      <div className="settings-filter-bar" role="group" aria-label="فیلتر وضعیت کارکنان">
        {(Object.keys(FILTER_LABELS) as Filter[]).map((option) => (
          <button
            key={option}
            type="button"
            className={`filter${filter === option ? " active" : ""}`}
            aria-pressed={filter === option}
            onClick={() => setFilter(option)}
          >
            {FILTER_LABELS[option]}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="empty-hint">کارمندی با این وضعیت ثبت نشده است.</p>
      ) : (
        <div className="settings-rows">
          {visible.map((member) => (
            <StaffRow
              key={member.id}
              member={member}
              isSelf={member.id === currentStaffId}
              lastActiveAdmin={member.isActive && member.role === "ADMIN" && activeAdmins <= 1}
              onUpdated={(updated) =>
                setStaff((current) =>
                  current.map((row) => (row.id === updated.id ? updated : row)),
                )
              }
              onDeleted={(id) => setStaff((current) => current.filter((row) => row.id !== id))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function CreateStaffForm({
  onCreated,
  onCancel,
}: {
  onCreated: (staff: SettingsStaff) => void;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<StaffRole>("OPERATOR");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const passwordValid =
    password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /[0-9]/.test(password);
  const complete = email.trim().length > 3 && fullName.trim().length >= 2 && passwordValid;

  function submit() {
    if (!complete) {
      setError("ایمیل، نام کامل و گذرواژهٔ موقت معتبر لازم است.");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.post(
          "/api/admin/settings/staff",
          { email: email.trim(), fullName: fullName.trim(), role, password },
          settingsStaffMutationSchema,
        );
        setPassword("");
        onCreated(response.staff);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="settings-create-card">
      <div className="form-grid">
        <label>
          ایمیل سازمانی
          <input
            type="email"
            dir="ltr"
            value={email}
            maxLength={254}
            onChange={(event) => setEmail(event.target.value)}
            disabled={pending}
          />
        </label>
        <label>
          نام کامل
          <input
            value={fullName}
            maxLength={100}
            onChange={(event) => setFullName(event.target.value)}
            disabled={pending}
          />
        </label>
        <label>
          نقش
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
            disabled={pending}
          >
            {STAFF_ROLE_VALUES.map((value) => (
              <option key={value} value={value}>
                {STAFF_ROLE_LABELS[value]}
              </option>
            ))}
          </select>
        </label>
        <label>
          گذرواژهٔ موقت
          <input
            type="password"
            dir="ltr"
            value={password}
            maxLength={128}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            disabled={pending}
          />
          <span className="settings-hint">
            حداقل ۱۲ نویسه، شامل حرف کوچک، حرف بزرگ و عدد. آن را از یک مسیر امن به کارمند بدهید.
          </span>
        </label>
      </div>

      <p className="warning">
        گذرواژه فقط برای ورود نخست است و در هیچ گزارشی ذخیره نمی‌شود. حساب بلافاصله پس از ساخت فعال خواهد بود.
      </p>

      <div className="settings-row-actions">
        <button type="button" className="secondary-btn" onClick={onCancel} disabled={pending}>
          انصراف
        </button>
        <button type="button" className="primary-btn" onClick={submit} disabled={!complete || pending}>
          {pending ? "در حال ساخت…" : "ساخت حساب"}
        </button>
      </div>
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
    </div>
  );
}

function StaffRow({
  member,
  isSelf,
  lastActiveAdmin,
  onUpdated,
  onDeleted,
}: {
  member: SettingsStaff;
  isSelf: boolean;
  lastActiveAdmin: boolean;
  onUpdated: (staff: SettingsStaff) => void;
  onDeleted: (id: string) => void;
}) {
  const [action, setAction] = useState<"status" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validReason = reason.trim().length >= SETTINGS_REASON_MIN_LENGTH;
  const blockDeactivate = isSelf || lastActiveAdmin;

  function open(next: "status" | "delete") {
    setAction((current) => (current === next ? null : next));
    setReason("");
    setError(null);
    setNotice(null);
  }

  function submitStatus() {
    if (!validReason) return;
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.patch(
          `/api/admin/settings/staff/${encodeURIComponent(member.id)}/status`,
          { isActive: !member.isActive, reason: reason.trim() },
          settingsStaffMutationSchema,
        );
        onUpdated(response.staff);
        setAction(null);
        setReason("");
        setNotice(response.staff.isActive ? "حساب فعال شد." : "دسترسی این حساب قطع شد.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function submitDelete() {
    if (!validReason) return;
    if (!window.confirm(`حساب «${member.fullName}» برای همیشه حذف شود؟`)) return;
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.post(
          `/api/admin/settings/staff/${encodeURIComponent(member.id)}/delete`,
          { reason: reason.trim() },
          settingsStaffDeleteSchema,
        );
        onDeleted(response.id);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <article className={`settings-row${member.isActive ? " is-on" : " is-off"}`}>
      <div className="settings-row-main">
        <div className="settings-status-rail" aria-hidden="true" />
        <div className="settings-row-copy">
          <div className="settings-row-title">
            <strong>{member.fullName}</strong>
            <span className={`badge ${member.isActive ? "badge-success" : "badge-danger"}`}>
              {member.isActive ? "فعال" : "غیرفعال"}
            </span>
            <span className="tag-pill">{STAFF_ROLE_LABELS[member.role]}</span>
            {isSelf ? <span className="settings-self">حساب شما</span> : null}
          </div>
          <p dir="ltr" className="settings-key">{member.email}</p>
          <div className="settings-meta">
            <span>
              آخرین ورود:{" "}
              {member.lastLoginAt ? formatJalaliDate(member.lastLoginAt) : "ثبت نشده"}
            </span>
            <span>عضویت در صف: {member.queues.length === 0 ? "—" : member.queues.map((queue) => queue.name).join("، ")}</span>
          </div>
        </div>
        <div className="settings-row-actions">
          <button
            type="button"
            className="secondary-btn"
            onClick={() => open("status")}
            disabled={pending || (member.isActive && blockDeactivate)}
          >
            {member.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
          </button>
          <button
            type="button"
            className="secondary-btn settings-danger"
            onClick={() => open("delete")}
            disabled={pending || member.isActive || isSelf}
          >
            حذف
          </button>
        </div>
      </div>

      {member.isActive && blockDeactivate ? (
        <p className="settings-hint">
          {isSelf
            ? "حسابی که با آن وارد شده‌اید قابل غیرفعال‌سازی نیست."
            : "این تنها مدیر فعال سامانه است؛ ابتدا مدیر دیگری را فعال کنید."}
        </p>
      ) : null}
      {member.isActive && !isSelf ? (
        <p className="settings-hint">برای حذف، ابتدا باید حساب غیرفعال شود.</p>
      ) : null}

      {action !== null ? (
        <div className="settings-row-editor">
          <label className="settings-reason-field">
            {action === "delete" ? "دلیل حذف حساب" : member.isActive ? "دلیل قطع دسترسی" : "دلیل بازگرداندن دسترسی"}
            <input
              value={reason}
              maxLength={500}
              placeholder="مثلاً: پایان همکاری از اول مهر"
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
            />
          </label>
          <div className="settings-row-actions">
            <button type="button" className="secondary-btn" onClick={() => setAction(null)} disabled={pending}>
              انصراف
            </button>
            <button
              type="button"
              className={action === "delete" ? "primary-btn settings-danger-solid" : "primary-btn"}
              onClick={action === "delete" ? submitDelete : submitStatus}
              disabled={!validReason || pending}
            >
              {pending
                ? "در حال ثبت…"
                : action === "delete"
                  ? "حذف دائمی"
                  : member.isActive
                    ? "قطع دسترسی"
                    : "فعال‌سازی حساب"}
            </button>
          </div>
        </div>
      ) : null}

      {action === "delete" ? (
        <p className="warning">
          حذف برگشت‌ناپذیر است. اگر این حساب سابقهٔ عملیاتی دارد، سامانه حذف را رد می‌کند و باید غیرفعال بماند.
        </p>
      ) : null}
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
    </article>
  );
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "انجام این تغییر ممکن نشد. دوباره تلاش کنید.";
}
