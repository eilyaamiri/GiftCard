"use client";

import { useRef, useState } from "react";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { InlineError, messageFor } from "../../../_components/error-notice";
import {
  fulfillment,
  type FulfillmentWorkspace,
  type PaymentReceiptView,
} from "../../../_lib/fulfillment";

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function receiptUrl(workItemId: string, receipt: PaymentReceiptView): string {
  return `/api/operator/fulfillment/${encodeURIComponent(workItemId)}/payment-receipt?v=${encodeURIComponent(receipt.uploadedAt)}`;
}

export function PaymentReceiptPanel({
  workItemId,
  receipt,
  disabled,
  onUploaded,
}: {
  workItemId: string;
  receipt: PaymentReceiptView | null;
  disabled: boolean;
  onUploaded: (workspace: FulfillmentWorkspace) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function choose(file: File | null) {
    setError(null);
    setSaved(false);
    if (file === null) {
      setSelected(null);
      return;
    }
    if (!ACCEPTED_TYPES.has(file.type)) {
      setSelected(null);
      setError("تصویر رسید باید با فرمت JPG، PNG یا WebP باشد.");
      if (input.current) input.current.value = "";
      return;
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      setSelected(null);
      setError("حجم تصویر رسید باید حداکثر ۵ مگابایت باشد.");
      if (input.current) input.current.value = "";
      return;
    }
    setSelected(file);
  }

  async function upload() {
    if (selected === null) {
      setError("ابتدا تصویر رسید را انتخاب کنید.");
      return;
    }
    setError(null);
    setSaved(false);
    setUploading(true);
    try {
      const workspace = await fulfillment.uploadPaymentReceipt(workItemId, selected);
      onUploaded(workspace);
      setSelected(null);
      setSaved(true);
      if (input.current) input.current.value = "";
    } catch (caught) {
      setError(messageFor(caught));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>اسکرین‌شات پرداخت</h3>
        <span>{receipt === null ? "پیوست اختیاری" : "ذخیره‌شده"}</span>
      </div>

      <p className="muted" style={{ marginBlockStart: 0 }}>
        تصویر ذخیره‌شده پس از اعلام نتیجه در پنل مشتری نمایش داده می‌شود و به همان ایمیل نیز پیوست خواهد شد.
      </p>
      <p className="warning">
        فقط نسخهٔ مناسب مشتری را بارگذاری کنید؛ تصویر نباید هویت تأمین‌کننده، اطلاعات ورود یا دادهٔ محرمانه داشته باشد.
      </p>

      {receipt === null ? null : (
        <figure style={{ margin: "16px 0", display: "grid", gap: 8 }}>
          {/* Authenticated same-origin endpoint; Next Image cannot forward the staff
              cookie through its server-side optimiser. */}
          <img
            key={receipt.uploadedAt}
            src={receiptUrl(workItemId, receipt)}
            alt="پیش‌نمایش اسکرین‌شات پرداخت ثبت‌شده"
            style={{
              display: "block",
              width: "100%",
              maxHeight: 420,
              objectFit: "contain",
              border: "1px solid var(--line)",
              borderRadius: 12,
              background: "var(--surface-subtle, #f8fafc)",
            }}
          />
          <figcaption className="muted" style={{ fontSize: 12 }}>
            {toPersianDigits(Math.ceil(receipt.sizeBytes / 1024))} کیلوبایت · ثبت در {formatJalaliDate(receipt.uploadedAt)}
          </figcaption>
        </figure>
      )}

      <div className="form-grid" style={{ alignItems: "end" }}>
        <label>
          {receipt === null ? "انتخاب تصویر" : "جایگزینی تصویر"}
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            disabled={disabled || uploading}
            onChange={(event) => choose(event.target.files?.[0] ?? null)}
          />
        </label>
        <div className="save-row" style={{ margin: 0 }}>
          <button
            type="button"
            className="primary-btn"
            disabled={disabled || uploading || selected === null}
            onClick={() => void upload()}
          >
            {uploading ? "در حال بارگذاری…" : receipt === null ? "ثبت تصویر رسید" : "جایگزینی تصویر"}
          </button>
        </div>
      </div>

      {selected === null ? null : (
        <p className="muted" style={{ fontSize: 12 }}>
          فایل انتخاب‌شده: {selected.name}
        </p>
      )}
      {saved ? <div className="success-box">تصویر رسید ذخیره شد.</div> : null}
      <InlineError message={error} />
    </div>
  );
}
