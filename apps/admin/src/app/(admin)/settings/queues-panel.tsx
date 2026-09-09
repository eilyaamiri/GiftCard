"use client";

import { useState, useTransition } from "react";
import { toPersianDigits } from "@barat/ui";
import { STAFF_ROLE_LABELS, api } from "@/lib/api";
import {
  SETTINGS_REASON_MIN_LENGTH,
  settingsQueueMutationSchema,
  type SettingsQueue,
  type SettingsStaff,
} from "./settings-schema";

export function QueuesPanel({
  initialQueues,
  staff,
}: {
  initialQueues: readonly SettingsQueue[];
  staff: readonly SettingsStaff[];
}) {
  const [queues, setQueues] = useState([...initialQueues]);
  const operators = staff.filter((member) => member.role === "OPERATOR" && member.isActive);
  const activeCount = queues.filter((queue) => queue.isActive).length;

  function replaceQueue(updated: SettingsQueue) {
    setQueues((current) => current.map((queue) => (queue.id === updated.id ? updated : queue)));
  }

  return (
    <section className="settings-ledger" aria-labelledby="queues-title">
      <header className="settings-ledger-head">
        <div>
          <h2 id="queues-title">صف‌ها</h2>
          <p>
            {toPersianDigits(activeCount)} صف فعال از {toPersianDigits(queues.length)} صف عملیاتی
          </p>
        </div>
      </header>

      <p className="settings-context-note">
        صف غیرفعال، برداشتن تسک جدید توسط اپراتور را متوقف می‌کند؛ تسک‌های موجود و دسترسی مدیران دست‌نخورده می‌ماند.
      </p>

      <div className="settings-rows">
        {queues.map((queue) => (
          <QueueRow key={queue.id} queue={queue} operators={operators} onSaved={replaceQueue} />
        ))}
      </div>
    </section>
  );
}

function QueueRow({
  queue,
  operators,
  onSaved,
}: {
  queue: SettingsQueue;
  operators: readonly SettingsStaff[];
  onSaved: (queue: SettingsQueue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(queue.name);
  const [description, setDescription] = useState(queue.description ?? "");
  const [isActive, setIsActive] = useState(queue.isActive);
  const [sla, setSla] = useState(queue.slaMinutes === null ? "" : String(queue.slaMinutes));
  const [reason, setReason] = useState("");
  const [memberIds, setMemberIds] = useState(
    () => new Set(queue.members.filter((member) => member.role === "OPERATOR").map((member) => member.id)),
  );
  const [membersReason, setMembersReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const slaMinutes = sla.trim() === "" ? null : Number(sla);
  const slaValid =
    slaMinutes === null || (Number.isInteger(slaMinutes) && slaMinutes >= 5 && slaMinutes <= 10_080);
  const configChanged =
    name.trim() !== queue.name ||
    description.trim() !== (queue.description ?? "") ||
    isActive !== queue.isActive ||
    slaMinutes !== queue.slaMinutes;
  const originalOperators = new Set(
    queue.members.filter((member) => member.role === "OPERATOR").map((member) => member.id),
  );
  const membersChanged =
    memberIds.size !== originalOperators.size ||
    [...memberIds].some((id) => !originalOperators.has(id));
  const nonOperatorMembers = queue.members.filter((member) => member.role !== "OPERATOR");

  function apply(updated: SettingsQueue, message: string) {
    onSaved(updated);
    setName(updated.name);
    setDescription(updated.description ?? "");
    setIsActive(updated.isActive);
    setSla(updated.slaMinutes === null ? "" : String(updated.slaMinutes));
    setMemberIds(
      new Set(updated.members.filter((member) => member.role === "OPERATOR").map((member) => member.id)),
    );
    setReason("");
    setMembersReason("");
    setNotice(message);
  }

  function saveConfig() {
    if (!configChanged || !slaValid || reason.trim().length < SETTINGS_REASON_MIN_LENGTH) {
      setError("مهلت پاسخ معتبر (۵ تا ۱۰۰۸۰ دقیقه) و دلیل تغییر با حداقل ۸ نویسه لازم است.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.patch(
          `/api/admin/settings/queues/${encodeURIComponent(queue.id)}`,
          {
            name: name.trim(),
            description: description.trim() === "" ? null : description.trim(),
            isActive,
            slaMinutes,
            reason: reason.trim(),
          },
          settingsQueueMutationSchema,
        );
        apply(response.queue, "تنظیمات صف ثبت شد.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function saveMembers() {
    if (!membersChanged || membersReason.trim().length < SETTINGS_REASON_MIN_LENGTH) {
      setError("برای تغییر اعضای صف، دلیل با حداقل ۸ نویسه وارد کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.put(
          `/api/admin/settings/queues/${encodeURIComponent(queue.id)}/operators`,
          { staffIds: [...memberIds], reason: membersReason.trim() },
          settingsQueueMutationSchema,
        );
        apply(response.queue, "اعضای صف به‌روزرسانی شد.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <article className={`settings-row${isActive ? " is-on" : " is-off"}`}>
      <div className="settings-row-main">
        <div className="settings-status-rail" aria-hidden="true" />
        <div className="settings-row-copy">
          <div className="settings-row-title">
            <strong>{queue.name}</strong>
            <span className={`badge ${queue.isActive ? "badge-success" : "badge-danger"}`}>
              {queue.isActive ? "فعال" : "غیرفعال"}
            </span>
          </div>
          <p>{queue.description ?? "توضیحی برای این صف ثبت نشده است."}</p>
          <div className="settings-meta">
            <code className="settings-key" dir="ltr">{queue.key}</code>
            <span>{toPersianDigits(queue.workItemCount)} تسک ثبت‌شده</span>
            <span>
              مهلت پاسخ: {queue.slaMinutes === null ? "تعریف نشده" : `${toPersianDigits(queue.slaMinutes)} دقیقه`}
            </span>
            <span>{toPersianDigits(queue.members.length)} عضو</span>
          </div>
        </div>
        <div className="settings-row-actions">
          <button type="button" className="secondary-btn" onClick={() => setOpen((value) => !value)}>
            {open ? "بستن" : "پیکربندی"}
          </button>
        </div>
      </div>

      {open ? (
        <>
          <div className="settings-row-editor settings-queue-editor">
            <label>
              نام صف
              <input value={name} maxLength={100} onChange={(event) => setName(event.target.value)} disabled={pending} />
            </label>
            <label>
              مهلت پاسخ (دقیقه)
              <input
                type="number"
                min="5"
                max="10080"
                dir="ltr"
                value={sla}
                placeholder="بدون مهلت"
                onChange={(event) => setSla(event.target.value)}
                disabled={pending}
              />
            </label>
            <label className="settings-full">
              توضیح
              <input
                value={description}
                maxLength={300}
                onChange={(event) => setDescription(event.target.value)}
                disabled={pending}
              />
            </label>
            <div className="toggle-row settings-full">
              <div>
                <strong>پذیرش تسک جدید</strong>
                <span>با غیرفعال‌شدن، اپراتورها نمی‌توانند تسک تازه‌ای از این صف بردارند.</span>
              </div>
              <label className="switch" aria-label={`وضعیت صف ${queue.name}`}>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(event) => setIsActive(event.target.checked)}
                  disabled={pending}
                />
                <span className="slider" />
              </label>
            </div>
            <label className="settings-reason-field settings-full">
              دلیل تغییر تنظیمات
              <input
                value={reason}
                maxLength={500}
                placeholder="مثلاً: کاهش مهلت پاسخ در شیفت صبح"
                onChange={(event) => setReason(event.target.value)}
                disabled={pending}
              />
            </label>
            <div className="settings-row-actions settings-full">
              <button
                type="button"
                className="primary-btn"
                onClick={saveConfig}
                disabled={!configChanged || pending}
              >
                {pending ? "در حال ثبت…" : "ثبت تنظیمات صف"}
              </button>
            </div>
          </div>

          <div className="settings-row-editor settings-queue-editor">
            <fieldset className="settings-member-picker settings-full">
              <legend>اپراتورهای این صف</legend>
              {operators.length === 0 ? (
                <p className="settings-hint">اپراتور فعالی برای انتساب وجود ندارد.</p>
              ) : (
                <div className="settings-member-grid">
                  {operators.map((operator) => (
                    <label key={operator.id} className="settings-member">
                      <input
                        type="checkbox"
                        checked={memberIds.has(operator.id)}
                        onChange={(event) => {
                          setMemberIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(operator.id);
                            else next.delete(operator.id);
                            return next;
                          });
                        }}
                        disabled={pending}
                      />
                      <span>
                        <strong>{operator.fullName}</strong>
                        <small dir="ltr">{operator.email}</small>
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {nonOperatorMembers.length > 0 ? (
                <p className="settings-hint">
                  اعضای غیر اپراتور دست‌نخورده می‌مانند:{" "}
                  {nonOperatorMembers
                    .map((member) => `${member.fullName} (${STAFF_ROLE_LABELS[member.role]})`)
                    .join("، ")}
                </p>
              ) : null}
            </fieldset>
            <label className="settings-reason-field settings-full">
              دلیل تغییر اعضا
              <input
                value={membersReason}
                maxLength={500}
                placeholder="مثلاً: جابه‌جایی اپراتور شیفت شب"
                onChange={(event) => setMembersReason(event.target.value)}
                disabled={pending}
              />
            </label>
            <div className="settings-row-actions settings-full">
              <button
                type="button"
                className="primary-btn"
                onClick={saveMembers}
                disabled={!membersChanged || pending}
              >
                {pending ? "در حال ثبت…" : "ثبت اعضای صف"}
              </button>
            </div>
          </div>
        </>
      ) : null}

      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
    </article>
  );
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "ثبت تغییر ممکن نشد. دوباره تلاش کنید.";
}
