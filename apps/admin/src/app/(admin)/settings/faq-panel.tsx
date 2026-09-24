"use client";

import { useState, useTransition } from "react";
import { toPersianDigits } from "@barat/ui";
import { api } from "@/lib/api";
import {
  settingsFaqDeleteSchema,
  settingsFaqMutationSchema,
  type SettingsFaq,
} from "./settings-schema";

/**
 * Admin control over the storefront's FAQ list.
 *
 * Unlike support channels this set is open: an admin adds, reorders, edits or
 * removes any entry. Only enabled entries reach `/help` and the landing page,
 * in ascending `sortOrder`.
 */
export function FaqPanel({ initialFaqs }: { initialFaqs: readonly SettingsFaq[] }) {
  const [faqs, setFaqs] = useState([...initialFaqs]);
  const [creating, setCreating] = useState(false);

  const liveCount = faqs.filter((faq) => faq.isEnabled).length;

  return (
    <section className="settings-ledger" aria-labelledby="faqs-title">
      <header className="settings-ledger-head">
        <div>
          <h2 id="faqs-title">سؤال‌های متداول</h2>
          <p>پرسش‌هایی که در صفحهٔ راهنما و صفحهٔ اصلی سایت به مشتری نشان داده می‌شود.</p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="settings-count">{toPersianDigits(liveCount)} سؤال فعال</span>
          <button type="button" className="primary-btn" onClick={() => setCreating((open) => !open)}>
            {creating ? "بستن فرم" : "افزودن سؤال"}
          </button>
        </div>
      </header>

      <p className="settings-context-note">
        سؤالی که غیرفعال باشد در سایت نمایش داده نمی‌شود. ترتیب نمایش بر اساس عدد «ترتیب» از کوچک به بزرگ است.
      </p>

      {creating ? (
        <CreateFaqForm
          onCreated={(created) => {
            setFaqs((current) => [...current, created]);
            setCreating(false);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : null}

      {faqs.length === 0 ? (
        <p className="empty-hint">هنوز سؤالی ثبت نشده است.</p>
      ) : (
        <div className="settings-rows">
          {[...faqs]
            .sort((first, second) => first.sortOrder - second.sortOrder)
            .map((faq) => (
              <FaqRow
                key={faq.id}
                faq={faq}
                onSaved={(updated) =>
                  setFaqs((current) => current.map((row) => (row.id === updated.id ? updated : row)))
                }
                onDeleted={(id) => setFaqs((current) => current.filter((row) => row.id !== id))}
              />
            ))}
        </div>
      )}
    </section>
  );
}

function CreateFaqForm({
  onCreated,
  onCancel,
}: {
  onCreated: (faq: SettingsFaq) => void;
  onCancel: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validQuestion = question.trim().length >= 4 && question.trim().length <= 200;
  const validAnswer = answer.trim().length >= 4 && answer.trim().length <= 2000;
  const complete = validQuestion && validAnswer;

  function submit() {
    if (!complete) {
      setError("پرسش و پاسخ را بررسی کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      try {
        const response = await api.post(
          "/api/admin/settings/faqs",
          { question: question.trim(), answer: answer.trim() },
          settingsFaqMutationSchema,
        );
        onCreated(response.faq);
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  return (
    <div className="settings-create-card">
      <div className="form-grid">
        <label>
          پرسش
          <input
            value={question}
            maxLength={200}
            onChange={(event) => setQuestion(event.target.value)}
            disabled={pending}
          />
        </label>
        <label className="settings-reason-field">
          پاسخ
          <textarea
            value={answer}
            maxLength={2000}
            rows={3}
            onChange={(event) => setAnswer(event.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      <div className="settings-row-actions">
        <button type="button" className="secondary-btn" onClick={onCancel} disabled={pending}>
          انصراف
        </button>
        <button type="button" className="primary-btn" onClick={submit} disabled={!complete || pending}>
          {pending ? "در حال ساخت…" : "افزودن سؤال"}
        </button>
      </div>
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
    </div>
  );
}

function FaqRow({
  faq,
  onSaved,
  onDeleted,
}: {
  faq: SettingsFaq;
  onSaved: (faq: SettingsFaq) => void;
  onDeleted: (id: string) => void;
}) {
  const [enabled, setEnabled] = useState(faq.isEnabled);
  const [question, setQuestion] = useState(faq.question);
  const [answer, setAnswer] = useState(faq.answer);
  const [sortOrder, setSortOrder] = useState(String(faq.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedOrder = Number(sortOrder);
  const validOrder = sortOrder.trim() !== "" && Number.isInteger(parsedOrder) && parsedOrder >= 0 && parsedOrder <= 999;
  const validQuestion = question.trim().length >= 4 && question.trim().length <= 200;
  const validAnswer = answer.trim().length >= 4 && answer.trim().length <= 2000;
  const changed =
    enabled !== faq.isEnabled ||
    question !== faq.question ||
    answer !== faq.answer ||
    parsedOrder !== faq.sortOrder;

  function reset() {
    setEnabled(faq.isEnabled);
    setQuestion(faq.question);
    setAnswer(faq.answer);
    setSortOrder(String(faq.sortOrder));
    setError(null);
    setNotice(null);
  }

  function touched() {
    setNotice(null);
  }

  function save() {
    if (!changed || !validOrder || !validQuestion || !validAnswer) {
      setError("پرسش، پاسخ و ترتیب را بررسی کنید.");
      return;
    }
    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.patch(
          `/api/admin/settings/faqs/${encodeURIComponent(faq.id)}`,
          { question: question.trim(), answer: answer.trim(), isEnabled: enabled, sortOrder: parsedOrder },
          settingsFaqMutationSchema,
        );
        onSaved(response.faq);
        setEnabled(response.faq.isEnabled);
        setQuestion(response.faq.question);
        setAnswer(response.faq.answer);
        setSortOrder(String(response.faq.sortOrder));
        setNotice("تغییرات سؤال ثبت شد.");
      } catch (caught) {
        setError(errorMessage(caught));
      }
    });
  }

  function remove() {
    if (!window.confirm("این سؤال برای همیشه حذف شود؟")) return;
    startTransition(async () => {
      setError(null);
      try {
        await api.del(`/api/admin/settings/faqs/${encodeURIComponent(faq.id)}`, settingsFaqDeleteSchema);
        onDeleted(faq.id);
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
            <strong>{question}</strong>
            <span className={`badge ${enabled ? "badge-success" : "badge-danger"}`}>
              {enabled ? "فعال" : "غیرفعال"}
            </span>
            {changed ? <span className="settings-unsaved">ذخیره‌نشده</span> : null}
          </div>
          <p>{answer}</p>
        </div>
        <label className="switch" aria-label={`وضعیت سؤال ${question}`}>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => {
              setEnabled(event.target.checked);
              touched();
            }}
            disabled={pending}
          />
          <span className="slider" />
        </label>
      </div>

      <div className="settings-row-editor">
        <label>
          پرسش
          <input
            value={question}
            maxLength={200}
            onChange={(event) => {
              setQuestion(event.target.value);
              touched();
            }}
            disabled={pending}
          />
        </label>
        <label className="settings-reason-field">
          پاسخ
          <textarea
            value={answer}
            maxLength={2000}
            rows={3}
            onChange={(event) => {
              setAnswer(event.target.value);
              touched();
            }}
            disabled={pending}
          />
        </label>
        <label>
          ترتیب نمایش
          <input
            type="number"
            min="0"
            max="999"
            step="1"
            inputMode="numeric"
            dir="ltr"
            value={sortOrder}
            onChange={(event) => {
              setSortOrder(event.target.value);
              touched();
            }}
            disabled={pending}
          />
        </label>
        <div className="settings-row-actions">
          <button type="button" className="secondary-btn settings-danger" onClick={remove} disabled={pending}>
            حذف
          </button>
          <button type="button" className="secondary-btn" onClick={reset} disabled={!changed || pending}>
            بازنشانی
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={save}
            disabled={!changed || !validOrder || !validQuestion || !validAnswer || pending}
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

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "ثبت تغییر ممکن نشد. دوباره تلاش کنید.";
}
