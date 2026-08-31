"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import { OFFER_AVAILABILITY_LABELS, type AdminOffer, type AdminSku, type OfferAvailability } from "../../catalog/_lib/catalog-contracts";
import { FormError } from "../../catalog/_components/form-error";

const AVAILABILITIES = Object.keys(OFFER_AVAILABILITY_LABELS) as OfferAvailability[];

export function OfferForm({
  supplierId,
  skus,
  offer,
  onDone,
}: {
  supplierId: string;
  skus: AdminSku[];
  offer?: AdminOffer;
  onDone: () => void;
}) {
  const router = useRouter();
  const isEdit = Boolean(offer);
  const [skuId, setSkuId] = useState(offer?.skuId ?? skus[0]?.id ?? "");
  const [costCurrency, setCostCurrency] = useState(offer?.costCurrency ?? "USD");
  const [costAmount, setCostAmount] = useState(offer?.costAmount ?? "");
  const [discountBps, setDiscountBps] = useState(String(offer?.discountBps ?? 0));
  const [availability, setAvailability] = useState<OfferAvailability>(offer?.availability ?? "AVAILABLE");
  const [priority, setPriority] = useState(String(offer?.priority ?? 100));
  const [isActive, setIsActive] = useState(offer?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      if (isEdit && offer) {
        await api.put(`/api/admin/catalog/offers/${offer.id}`, {
          costCurrency: costCurrency.trim().toUpperCase(),
          costAmount: costAmount.trim(),
          discountBps: Number(discountBps) || 0,
          availability,
          priority: Number(priority) || 0,
          isActive,
        });
      } else {
        await api.post("/api/admin/catalog/offers", {
          supplierId,
          skuId,
          costCurrency: costCurrency.trim().toUpperCase(),
          costAmount: costAmount.trim(),
          discountBps: Number(discountBps) || 0,
          availability,
          priority: Number(priority) || 0,
          isActive,
        });
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
          SKU
          <select value={skuId} onChange={(event) => setSkuId(event.target.value)} disabled={isEdit} required>
            {skus.map((sku) => (
              <option key={sku.id} value={sku.id}>
                {sku.product ? `${sku.product.titleFa} — ` : ""}
                {sku.code} ({sku.denominationLabel})
              </option>
            ))}
          </select>
        </label>
        <label>
          ارز هزینه
          <input value={costCurrency} onChange={(event) => setCostCurrency(event.target.value)} required maxLength={3} className="bp-ltr" />
        </label>
        <label>
          مبلغ هزینه (Cost)
          <input value={costAmount} onChange={(event) => setCostAmount(event.target.value)} required inputMode="decimal" className="bp-ltr" placeholder="9.50" />
        </label>
        <label>
          تخفیف (basis points)
          <input value={discountBps} onChange={(event) => setDiscountBps(event.target.value)} type="number" min={0} max={10000} className="bp-ltr" />
        </label>
        <label>
          اولویت
          <input value={priority} onChange={(event) => setPriority(event.target.value)} type="number" min={0} className="bp-ltr" />
        </label>
        <label>
          موجودی
          <select value={availability} onChange={(event) => setAvailability(event.target.value as OfferAvailability)}>
            {AVAILABILITIES.map((value) => (
              <option key={value} value={value}>
                {OFFER_AVAILABILITY_LABELS[value]}
              </option>
            ))}
          </select>
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
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ Offer" : "افزودن Offer"}
        </button>
      </div>
    </form>
  );
}
