"use client";

import { useRef, useState } from "react";
import type { DeliveryAssetType } from "@barat/contracts";
import { parseDecimalText } from "@/lib/format-bps";
import { InlineError } from "../../../_components/error-notice";
import { DELIVERY_ASSET_TYPE_LABEL, type AssetInput, type RecordSupplierResultInput } from "../../../_lib/fulfillment";

const ASSET_TYPES: readonly DeliveryAssetType[] = ["CODE", "CODE_PIN", "URL", "PROVIDER_DIRECT_EMAIL"];
const CURRENCIES = ["USD", "EUR", "GBP", "TRY", "AED"];

/**
 * Records what the supplier actually returned.
 *
 * This is the only screen where a gift-card code is typed. The value lives in
 * component state for exactly as long as the operator is typing it, goes out in
 * a POST body, and is wiped the moment the server accepts it — it is never put
 * in a URL, in storage, or in a log. The server rejects a `code` on a URL or
 * PROVIDER_DIRECT_EMAIL asset outright; the disabled field here is convenience.
 */
export function SupplierResultForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (input: RecordSupplierResultInput) => Promise<void>;
}) {
  const [assetType, setAssetType] = useState<DeliveryAssetType>("CODE");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [deliveryUrl, setDeliveryUrl] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [cost, setCost] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // One key per mount: a double-click must not buy the same card twice.
  const idempotencyKey = useRef<string>(globalThis.crypto.randomUUID()).current;

  function buildAsset(): AssetInput | null {
    const expiry = expiryDate ? new Date(expiryDate).toISOString() : undefined;
    switch (assetType) {
      case "CODE":
        if (code.trim().length < 4) return null;
        return {
          assetType,
          code: code.trim(),
          ...(serialNumber.trim() ? { serialNumber: serialNumber.trim() } : {}),
          ...(expiry ? { expiryDate: expiry } : {}),
        };
      case "CODE_PIN":
        if (code.trim().length < 4 || pin.trim().length < 3) return null;
        return {
          assetType,
          code: code.trim(),
          pin: pin.trim(),
          ...(serialNumber.trim() ? { serialNumber: serialNumber.trim() } : {}),
          ...(expiry ? { expiryDate: expiry } : {}),
        };
      case "URL":
        if (!deliveryUrl.trim()) return null;
        return { assetType, deliveryUrl: deliveryUrl.trim(), ...(expiry ? { expiryDate: expiry } : {}) };
      case "PROVIDER_DIRECT_EMAIL":
        if (!recipientEmail.trim()) return null;
        return { assetType, recipientEmail: recipientEmail.trim() };
    }
  }

  async function handleSubmit() {
    setError(null);
    const asset = buildAsset();
    if (!asset) {
      setError("اطلاعات دارایی تحویل کامل نیست.");
      return;
    }

    // Money never becomes a JS number: the decimal string is validated as text
    // and sent as text.
    let costString: string | undefined;
    if (cost.trim()) {
      const parsed = parseDecimalText(cost);
      if (parsed === null) {
        setError("هزینهٔ واقعی باید یک عدد اعشاری معتبر باشد.");
        return;
      }
      costString = parsed;
    }

    setSaving(true);
    try {
      await onSubmit({
        asset,
        idempotencyKey,
        ...(supplierReference.trim() ? { supplierReference: supplierReference.trim() } : {}),
        ...(costString ? { actualSupplierCost: costString, actualSupplierCurrency: currency } : {}),
      });
      // The plaintext has been accepted by the server; nothing keeps it here.
      setCode("");
      setPin("");
      setDeliveryUrl("");
      setRecipientEmail("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ثبت نتیجهٔ تأمین‌کننده ناموفق بود.");
    } finally {
      setSaving(false);
    }
  }

  const locked = disabled || saving;

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>ثبت نتیجهٔ تأمین‌کننده</h3>
        <span>یک‌بار برای هر سفارش</span>
      </div>

      <p className="warning">
        این فرم فقط یک‌بار برای هر سفارش پذیرفته می‌شود. اگر خرید قبلاً انجام شده، هرگز خرید تازه‌ای ثبت نکنید.
      </p>

      <div className="form-grid">
        <label>
          نوع دارایی تحویل
          <select
            value={assetType}
            disabled={locked}
            onChange={(event) => setAssetType(event.target.value as DeliveryAssetType)}
          >
            {ASSET_TYPES.map((type) => (
              <option key={type} value={type}>
                {DELIVERY_ASSET_TYPE_LABEL[type]}
              </option>
            ))}
          </select>
        </label>

        <label>
          کد پیگیری تأمین‌کننده
          <input
            className="bp-ltr"
            value={supplierReference}
            disabled={locked}
            onChange={(event) => setSupplierReference(event.target.value)}
            placeholder="مثلاً TLO-9924123"
          />
        </label>

        {assetType === "CODE" || assetType === "CODE_PIN" ? (
          <label>
            کد گیفت‌کارت
            <input
              className="bp-ltr"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={code}
              disabled={locked}
              onChange={(event) => setCode(event.target.value)}
              placeholder="کد را دقیقاً همان‌طور که تأمین‌کننده داده وارد کنید"
            />
          </label>
        ) : null}

        {assetType === "CODE_PIN" ? (
          <label>
            پین
            <input
              className="bp-ltr"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={pin}
              disabled={locked}
              onChange={(event) => setPin(event.target.value)}
            />
          </label>
        ) : null}

        {assetType === "CODE" || assetType === "CODE_PIN" ? (
          <label>
            شمارهٔ سریال (اختیاری)
            <input
              className="bp-ltr"
              value={serialNumber}
              disabled={locked}
              onChange={(event) => setSerialNumber(event.target.value)}
            />
          </label>
        ) : null}

        {assetType === "URL" ? (
          <label>
            لینک بازخرید
            <input
              className="bp-ltr"
              value={deliveryUrl}
              disabled={locked}
              onChange={(event) => setDeliveryUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
        ) : null}

        {assetType === "PROVIDER_DIRECT_EMAIL" ? (
          <label>
            ایمیل گیرنده نزد تأمین‌کننده
            <input
              className="bp-ltr"
              type="email"
              value={recipientEmail}
              disabled={locked}
              onChange={(event) => setRecipientEmail(event.target.value)}
            />
          </label>
        ) : null}

        {assetType !== "PROVIDER_DIRECT_EMAIL" ? (
          <label>
            تاریخ انقضا (اختیاری)
            <input
              type="date"
              className="bp-ltr"
              value={expiryDate}
              disabled={locked}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
          </label>
        ) : null}

        <label>
          هزینهٔ واقعی تأمین‌کننده
          <input
            className="bp-ltr"
            inputMode="decimal"
            value={cost}
            disabled={locked}
            onChange={(event) => setCost(event.target.value)}
            placeholder="مثلاً 46.80"
          />
        </label>

        <label>
          واحد پول
          <select value={currency} disabled={locked} onChange={(event) => setCurrency(event.target.value)}>
            {CURRENCIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
      </div>

      {assetType === "PROVIDER_DIRECT_EMAIL" ? (
        <p className="muted">
          در این حالت تأمین‌کننده کد را مستقیماً برای مشتری ایمیل می‌کند و هیچ کدی نزد ما ذخیره نمی‌شود.
        </p>
      ) : null}

      <div className="save-row">
        <button type="button" className="primary-btn" disabled={locked} onClick={() => void handleSubmit()}>
          {saving ? "در حال ثبت…" : "ثبت نتیجهٔ تأمین‌کننده"}
        </button>
      </div>

      <InlineError message={error} />
    </div>
  );
}
