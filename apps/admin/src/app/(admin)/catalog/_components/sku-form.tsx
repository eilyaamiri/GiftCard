"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { DeliveryAssetType } from "@barat/contracts";
import { ApiClientError, api } from "@/lib/api";
import { DELIVERY_ASSET_TYPE_LABELS, type AdminSku } from "../_lib/catalog-contracts";
import { regionDisplay, regionName, regionOptions } from "../_lib/regions";
import { FormError } from "./form-error";

const DELIVERY_ASSET_TYPES = Object.keys(DELIVERY_ASSET_TYPE_LABELS) as DeliveryAssetType[];
const REGION_OPTIONS = regionOptions();

export function SkuForm({ productId, sku, onDone }: { productId: string; sku?: AdminSku; onDone: () => void }) {
  const router = useRouter();
  const isEdit = Boolean(sku);
  const [code, setCode] = useState(sku?.code ?? "");
  const [region, setRegion] = useState(sku?.region ?? "");
  const [currency, setCurrency] = useState(sku?.currency ?? "USD");
  const [faceValue, setFaceValue] = useState(sku?.faceValue ?? "");
  const [denominationLabel, setDenominationLabel] = useState(sku?.denominationLabel ?? "");
  const [deliveryAssetType, setDeliveryAssetType] = useState<DeliveryAssetType>(sku?.deliveryAssetType ?? "CODE");
  const [minQuantity, setMinQuantity] = useState(String(sku?.minQuantity ?? 1));
  const [maxQuantity, setMaxQuantity] = useState(String(sku?.maxQuantity ?? 10));
  const [isActive, setIsActive] = useState(sku?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      code: code.trim(),
      region: region.trim().toUpperCase(),
      currency: currency.trim().toUpperCase(),
      faceValue: faceValue.trim(),
      denominationLabel: denominationLabel.trim(),
      deliveryAssetType,
      minQuantity: Number(minQuantity) || 1,
      maxQuantity: Number(maxQuantity) || 1,
      isActive,
    };
    try {
      if (isEdit && sku) {
        await api.put(`/api/admin/catalog/skus/${sku.id}`, payload);
      } else {
        await api.post("/api/admin/catalog/skus", { productId, ...payload });
      }
      router.refresh();
      onDone();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card panel" style={{ marginTop: 12 }}>
      <FormError message={error} />
      <div className="form-grid">
        <label>
          کد SKU
          <input value={code} onChange={(event) => setCode(event.target.value)} required maxLength={120} dir="ltr" />
        </label>
        <label>
          منطقه
          {/* A list, not a free code: the name is what a person recognises, and the code is what is stored. */}
          <select value={region} onChange={(event) => setRegion(event.target.value)} required>
            <option value="" disabled>
              انتخاب منطقه…
            </option>
            {/* A value the list does not hold (the supplier's own word, or an alias) is kept as it is until a region is chosen. */}
            {region !== "" && !REGION_OPTIONS.some((option) => option.code === region) ? (
              <option value={region}>
                {regionName(region) === null ? `${region} — نامشخص، یک منطقه انتخاب کنید` : regionDisplay(region)}
              </option>
            ) : null}
            {REGION_OPTIONS.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name} ({option.code})
              </option>
            ))}
          </select>
        </label>
        <label>
          ارز
          <input value={currency} onChange={(event) => setCurrency(event.target.value)} required maxLength={3} className="bp-ltr" />
        </label>
        <label>
          ارزش اسمی (Face value)
          <input value={faceValue} onChange={(event) => setFaceValue(event.target.value)} required inputMode="decimal" className="bp-ltr" placeholder="50" />
        </label>
        <label>
          برچسب مبلغ
          <input value={denominationLabel} onChange={(event) => setDenominationLabel(event.target.value)} required maxLength={120} placeholder="$50" />
        </label>
        <label>
          نوع تحویل
          <select value={deliveryAssetType} onChange={(event) => setDeliveryAssetType(event.target.value as DeliveryAssetType)}>
            {DELIVERY_ASSET_TYPES.map((type) => (
              <option key={type} value={type}>
                {DELIVERY_ASSET_TYPE_LABELS[type]}
              </option>
            ))}
          </select>
        </label>
        <label>
          حداقل تعداد سفارش
          <input value={minQuantity} onChange={(event) => setMinQuantity(event.target.value)} type="number" min={1} className="bp-ltr" />
        </label>
        <label>
          حداکثر تعداد سفارش
          <input value={maxQuantity} onChange={(event) => setMaxQuantity(event.target.value)} type="number" min={1} max={100} className="bp-ltr" />
        </label>
        <label>
          وضعیت
          <select value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </label>
      </div>
      <div className="save-row">
        <button type="button" className="secondary-btn" style={{ marginInlineEnd: 10 }} onClick={onDone}>
          انصراف
        </button>
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ SKU" : "افزودن SKU"}
        </button>
      </div>
    </form>
  );
}
