"use client";

import { useState, useTransition } from "react";
import { toPersianDigits } from "@barat/ui";
import { api } from "@/lib/api";
import {
  settingsSupportChannelMutationSchema,
  type SettingsSupportChannel,
} from "./settings-schema";

const CHANNEL_COPY: Record<
  SettingsSupportChannel["kind"],
  { readonly label: string; readonly valueLabel: string; readonly placeholder: string; readonly hint: string }
> = {
  PHONE: {
    label: "تماس تلفنی",
    valueLabel: "شمارهٔ تماس",
    placeholder: "۰۲۱۹۱۰۰۱۲۳۴",
    hint: "شماره با کد شهر یا با کد کشور. فاصله و خط تیره حذف می‌شود.",
  },
  TELEGRAM: {
    label: "تلگرام",
    valueLabel: "شناسه یا لینک تلگرام",
    placeholder: "@baratpay",
    hint: "شناسه یا لینک t.me. پس از ثبت به شکل https://t.me/… ذخیره می‌شود.",
  },
  WHATSAPP: {
    label: "واتساپ",
    valueLabel: "شماره یا لینک واتساپ",
    placeholder: "۹۸۹۱۲۱۲۳۴۵۶۷",
    hint: "شماره با کد کشور و بدون صفر ابتدایی، یا لینک wa.me.",
  },
  TICKET: {
    label: "ثبت تیکت",
    valueLabel: "مسیر صفحهٔ ثبت تیکت",
    placeholder: "/account/support",
    hint: "فقط مسیر داخلی سایت. آدرس کامل پذیرفته نمی‌شود.",
  },
};

/**
 * Admin control over what the storefront's contact sheet offers.
 *
 * The four channels are fixed; only their content, order and on/off state are
 * editable here. Switching one on without a destination is refused by the API
 * as well as by this form, because an enabled-but-empty channel would render as
 * a dead row on every phone.
 */
export function SupportChannelsPanel({
  initialChannels,
}: {
  initialChannels: readonly SettingsSupportChannel[];
}) {
  const [channels, setChannels] = useState([...initialChannels]);

  function replaceChannel(updated: SettingsSupportChannel) {
    setChannels((current) => current.map((channel) => (channel.kind === updated.kind ? updated : channel)));
  }

  const liveCount = channels.filter((channel) => channel.isEnabled && channel.value !== "").length;

  return (
    <section className="settings-ledger" aria-labelledby="support-channels-title">
      <header className="settings-ledger-head">
        <div>
          <h2 id="support-channels-title">تنظیمات پشتیبانی</h2>
          <p>راه‌های ارتباطی که در منوی موبایل سایت به مشتری نشان داده می‌شود.</p>
        </div>
        <span className="settings-count">{toPersianDigits(liveCount)} کانال فعال</span>
      </header>

      <p className="settings-context-note">
        کانالی که فعال باشد اما مقدار آن خالی بماند، به مشتری نمایش داده نمی‌شود. ترتیب نمایش بر اساس عدد «ترتیب» از کوچک به بزرگ است.
      </p>

      <div className="settings-rows">
        {[...channels]
          .sort((first, second) => first.sortOrder - second.sortOrder)
          .map((channel) => (
            <SupportChannelRow key={channel.kind} channel={channel} onSaved={replaceChannel} />
          ))}
      </div>
    </section>
  );
}

function SupportChannelRow({
  channel,
  onSaved,
}: {
  channel: SettingsSupportChannel;
  onSaved: (channel: SettingsSupportChannel) => void;
}) {
  const copy = CHANNEL_COPY[channel.kind];
  const [enabled, setEnabled] = useState(channel.isEnabled);
  const [title, setTitle] = useState(channel.title);
  const [description, setDescription] = useState(channel.description);
  const [value, setValue] = useState(channel.value);
  const [sortOrder, setSortOrder] = useState(String(channel.sortOrder));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedOrder = Number(sortOrder);
  const validOrder = sortOrder.trim() !== "" && Number.isInteger(parsedOrder) && parsedOrder >= 0 && parsedOrder <= 99;
  const validTitle = title.trim().length >= 2 && title.trim().length <= 60;
  /* The API refuses this too; catching it here means the admin is told before a
   * round trip rather than by a validation envelope. */
  const validValue = !enabled || value.trim() !== "";
  const changed =
    enabled !== channel.isEnabled ||
    title !== channel.title ||
    description !== channel.description ||
    value !== channel.value ||
    parsedOrder !== channel.sortOrder;

  function reset() {
    setEnabled(channel.isEnabled);
    setTitle(channel.title);
    setDescription(channel.description);
    setValue(channel.value);
    setSortOrder(String(channel.sortOrder));
    setError(null);
    setNotice(null);
  }

  function touched() {
    setNotice(null);
  }

  function save() {
    if (!changed || !validOrder || !validTitle || !validValue) {
      setError("عنوان، ترتیب و مقدار کانال را بررسی کنید.");
      return;
    }

    startTransition(async () => {
      setError(null);
      setNotice(null);
      try {
        const response = await api.patch(
          `/api/admin/settings/support-channels/${encodeURIComponent(channel.kind)}`,
          {
            isEnabled: enabled,
            title: title.trim(),
            description: description.trim(),
            value: value.trim(),
            sortOrder: parsedOrder,
          },
          settingsSupportChannelMutationSchema,
        );
        onSaved(response.channel);
        /* The stored value is the normalised one, so the field is refilled from
         * the response: an admin who typed `@baratpay` sees the link that was
         * actually saved. */
        setEnabled(response.channel.isEnabled);
        setTitle(response.channel.title);
        setDescription(response.channel.description);
        setValue(response.channel.value);
        setSortOrder(String(response.channel.sortOrder));
        setNotice("تغییرات کانال ثبت شد.");
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
            <strong>{copy.label}</strong>
            <span className={`badge ${enabled ? "badge-success" : "badge-danger"}`}>
              {enabled ? "فعال" : "غیرفعال"}
            </span>
            {changed ? <span className="settings-unsaved">ذخیره‌نشده</span> : null}
          </div>
          <p>{copy.hint}</p>
          <code className="settings-key" dir="ltr">{channel.kind}</code>
        </div>
        <label className="switch" aria-label={`وضعیت ${copy.label}`}>
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
          عنوان
          <input
            value={title}
            maxLength={60}
            onChange={(event) => {
              setTitle(event.target.value);
              touched();
            }}
            disabled={pending}
          />
        </label>
        <label>
          {copy.valueLabel}
          <input
            value={value}
            maxLength={200}
            dir="ltr"
            placeholder={copy.placeholder}
            onChange={(event) => {
              setValue(event.target.value);
              touched();
            }}
            disabled={pending}
          />
        </label>
        <label className="settings-reason-field">
          توضیح کوتاه
          <input
            value={description}
            maxLength={160}
            placeholder="مثلاً: پاسخ‌گویی شنبه تا چهارشنبه، ۹ تا ۱۷"
            onChange={(event) => {
              setDescription(event.target.value);
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
            max="99"
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
          <button type="button" className="secondary-btn" onClick={reset} disabled={!changed || pending}>
            بازنشانی
          </button>
          <button
            type="button"
            className="primary-btn"
            onClick={save}
            disabled={!changed || !validOrder || !validTitle || !validValue || pending}
          >
            {pending ? "در حال ثبت…" : "ثبت تغییر"}
          </button>
        </div>
      </div>
      {!validValue ? (
        <p className="settings-message error" role="alert">
          برای فعال‌کردن این کانال باید مقدار آن را وارد کنید.
        </p>
      ) : null}
      {error ? <p className="settings-message error" role="alert">{error}</p> : null}
      {notice ? <p className="settings-message success" role="status">{notice}</p> : null}
    </article>
  );
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "ثبت تغییر ممکن نشد. دوباره تلاش کنید.";
}
