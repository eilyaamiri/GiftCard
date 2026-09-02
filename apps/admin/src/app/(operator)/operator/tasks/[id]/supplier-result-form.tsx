"use client";

import { useRef, useState } from "react";
import type { DeliveryAssetType } from "@barat/contracts";
import { parseDecimalText } from "@/lib/format-bps";
import { InlineError } from "../../../_components/error-notice";
import { DELIVERY_ASSET_TYPE_LABEL, type AssetInput, type RecordSupplierResultInput } from "../../../_lib/fulfillment";

const CURRENCIES = ["USD", "EUR", "GBP", "TRY", "AED"];

/**
 * The vocabulary of the two jobs this form serves.
 *
 * An international payment has no code, no PIN and no gift card: the operator
 * pays an invoice and files the proof. Offering the code asset types there
 * would put a gift-card field on a payment task, so the variant decides which
 * asset types exist at all rather than only relabelling them.
 */
const VARIANTS = {
  GIFT_CARD: {
    heading: "ثبت نتیجهٔ تأمین‌کننده",
    submit: "ثبت نتیجهٔ تأمین‌کننده",
    saving: "در حال ثبت…",
    referenceLabel: "کد پیگیری تأمین‌کننده",
    referencePlaceholder: "مثلاً TLO-9924123",
    costLabel: "هزینهٔ واقعی تأمین‌کننده",
    assetTypeLabel: "نوع دارایی تحویل",
    assetTypes: ["CODE", "CODE_PIN", "URL", "PROVIDER_DIRECT_EMAIL"],
    incomplete: "اطلاعات دارایی تحویل کامل نیست.",
    failed: "ثبت نتیجهٔ تأمین‌کننده ناموفق بود.",
  },
  INTERNATIONAL_PAYMENT: {
    heading: "ثبت نتیجهٔ پرداخت",
    submit: "ثبت نتیجهٔ پرداخت",
    saving: "در حال ثبت…",
    referenceLabel: "کد رهگیری تراکنش",
    referencePlaceholder: "مثلاً ch_3PqR8s2eZvKY",
    costLabel: "مبلغ واقعی پرداخت‌شده",
    assetTypeLabel: "مدرک پرداخت",
    assetTypes: ["URL", "PROVIDER_DIRECT_EMAIL"],
    incomplete: "مدرک پرداخت کامل نیست.",
    failed: "ثبت نتیجهٔ پرداخت ناموفق بود.",
  },
} as const satisfies Record<
  string,
  { readonly assetTypes: readonly DeliveryAssetType[] } & Record<string, unknown>
>;

export type SupplierResultVariant = keyof typeof VARIANTS;

/**
 * Records what the supplier actually returned, or how a foreign invoice was
 * paid.
 *
 * This is the only screen where a gift-card code is typed. The value lives in
 * component state for exactly as long as the operator is typing it, goes out in
 * a POST body, and is wiped the moment the server accepts it — it is never put
 * in a URL, in storage, or in a log. The server rejects a `code` on a URL or
 * PROVIDER_DIRECT_EMAIL asset outright; the disabled field here is convenience.
 */
export function SupplierResultForm({
  disabled,
  variant = "GIFT_CARD",
  onSubmit,
}: {
  disabled: boolean;
  variant?: SupplierResultVariant;
  onSubmit: (input: RecordSupplierResultInput) => Promise<void>;
}) {
  const copy = VARIANTS[variant];
  const [assetType, setAssetType] = useState<DeliveryAssetType>(copy.assetTypes[0] ?? "CODE");
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
      setError(copy.incomplete);
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
      setError(caught instanceof Error ? caught.message : copy.failed);
    } finally {
      setSaving(false);
    }
  }

  const locked = disabled || saving;

  return (
    <div className="card workspace-card">
      <div className="section-label">
        <h3>{copy.heading}</h3>
        <span>یک‌بار برای هر سفارش</span>
      </div>

      <p className="warning">
        {variant === "INTERNATIONAL_PAYMENT"
          ? "این فرم فقط یک‌بار برای هر سفارش پذیرفته می‌شود. اگر پرداخت قبلاً انجام شده، هرگز پرداخت تازه‌ای ثبت نکنید."
          : "این فرم فقط یک‌بار برای هر سفارش پذیرفته می‌شود. اگر خرید قبلاً انجام شده، هرگز خرید تازه‌ای ثبت نکنید."}
      </p>

      <div className="form-grid">
        <label>
          {copy.assetTypeLabel}
          <select
            value={assetType}
            disabled={locked}
            onChange={(event) => setAssetType(event.target.value as DeliveryAssetType)}
          >
            {copy.assetTypes.map((type) => (
              <option key={type} value={type}>
                {assetTypeLabel(variant, type)}
              </option>
            ))}
          </select>
        </label>

        <label>
          {copy.referenceLabel}
          <input
            className="bp-ltr"
            value={supplierReference}
            disabled={locked}
            onChange={(event) => setSupplierReference(event.target.value)}
            placeholder={copy.referencePlaceholder}
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
            {variant === "INTERNATIONAL_PAYMENT" ? "لینک رسید پرداخت" : "لینک بازخرید"}
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
            {variant === "INTERNATIONAL_PAYMENT" ? "ایمیلی که سرویس تأییدیه را به آن فرستاده" : "ایمیل گیرنده نزد تأمین‌کننده"}
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
          {copy.costLabel}
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
          {variant === "INTERNATIONAL_PAYMENT"
            ? "در این حالت خود سرویس تأییدیهٔ پرداخت را مستقیماً برای مشتری ایمیل کرده و مدرکی نزد ما ذخیره نمی‌شود."
            : "در این حالت تأمین‌کننده کد را مستقیماً برای مشتری ایمیل می‌کند و هیچ کدی نزد ما ذخیره نمی‌شود."}
        </p>
      ) : null}

      <div className="save-row">
        <button type="button" className="primary-btn" disabled={locked} onClick={() => void handleSubmit()}>
          {saving ? copy.saving : copy.submit}
        </button>
      </div>

      <InlineError message={error} />
    </div>
  );
}

/** The asset types mean different things on a payment task than on a card. */
function assetTypeLabel(variant: SupplierResultVariant, assetType: DeliveryAssetType): string {
  if (variant === "GIFT_CARD") {
    return DELIVERY_ASSET_TYPE_LABEL[assetType];
  }
  switch (assetType) {
    case "URL":
      return "لینک رسید پرداخت";
    case "PROVIDER_DIRECT_EMAIL":
      return "تأییدیهٔ مستقیم سرویس به مشتری";
    default:
      return DELIVERY_ASSET_TYPE_LABEL[assetType];
  }
}
