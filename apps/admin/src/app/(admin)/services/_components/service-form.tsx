"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import type { AdminService } from "../../catalog/_lib/catalog-contracts";
import { FormError } from "../../catalog/_components/form-error";

export function ServiceForm({ service }: { service?: AdminService }) {
  const router = useRouter();
  const isEdit = Boolean(service);
  const [slug, setSlug] = useState(service?.slug ?? "");
  const [name, setName] = useState(service?.name ?? "");
  const [nameFa, setNameFa] = useState(service?.nameFa ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [currency, setCurrency] = useState(service?.currency ?? "USD");
  const [minAmount, setMinAmount] = useState(service?.minAmount ?? "");
  const [maxAmount, setMaxAmount] = useState(service?.maxAmount ?? "");
  const [sortOrder, setSortOrder] = useState(String(service?.sortOrder ?? 0));
  const [requiresManualReview, setRequiresManualReview] = useState(service?.requiresManualReview ?? true);
  const [isActive, setIsActive] = useState(service?.isActive ?? true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const payload = {
      slug: slug.trim(),
      name: name.trim(),
      nameFa: nameFa.trim(),
      category: category.trim(),
      currency: currency.trim().toUpperCase(),
      minAmount: minAmount.trim() || null,
      maxAmount: maxAmount.trim() || null,
      sortOrder: Number(sortOrder) || 0,
      requiresManualReview,
      isActive,
    };
    try {
      if (isEdit && service) {
        await api.put(`/api/admin/catalog/services/${service.id}`, payload);
        router.refresh();
      } else {
        const created = await api.post<{ id: string }>("/api/admin/catalog/services", { ...payload, fields: [] });
        router.push(`/services/${created.id}`);
        router.refresh();
      }
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card panel">
      <FormError message={error} />
      <div className="form-grid">
        <label>
          اسلاگ (slug)
          <input value={slug} onChange={(event) => setSlug(event.target.value)} required maxLength={120} dir="ltr" />
        </label>
        <label>
          نام (انگلیسی)
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={240} dir="ltr" />
        </label>
        <label>
          نام فارسی
          <input value={nameFa} onChange={(event) => setNameFa(event.target.value)} required maxLength={240} />
        </label>
        <label>
          دسته‌بندی
          <input value={category} onChange={(event) => setCategory(event.target.value)} required maxLength={120} />
        </label>
        <label>
          ارز
          <input value={currency} onChange={(event) => setCurrency(event.target.value)} required maxLength={3} className="bp-ltr" />
        </label>
        <label>
          ترتیب نمایش
          <input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} type="number" className="bp-ltr" />
        </label>
        <label>
          حداقل مبلغ (اختیاری)
          <input value={minAmount} onChange={(event) => setMinAmount(event.target.value)} inputMode="decimal" className="bp-ltr" />
        </label>
        <label>
          حداکثر مبلغ (اختیاری)
          <input value={maxAmount} onChange={(event) => setMaxAmount(event.target.value)} inputMode="decimal" className="bp-ltr" />
        </label>
        <label>
          نیاز به بازبینی دستی
          <select value={requiresManualReview ? "true" : "false"} onChange={(event) => setRequiresManualReview(event.target.value === "true")}>
            <option value="true">بله</option>
            <option value="false">خیر</option>
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
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : isEdit ? "ذخیرهٔ تغییرات" : "افزودن سرویس"}
        </button>
      </div>
    </form>
  );
}
