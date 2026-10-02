"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import type { AdminTopUpGameDetail } from "../../_lib/catalog-contracts";
import { FormError } from "../../_components/form-error";

/**
 * Curation for one top-up game.
 *
 * `slug`, `providerCategoryId` and `isListed` are absent on purpose. The first
 * two identify the game at the venue and renaming them would orphan it from the
 * next sync; `isListed` is the venue's answer and is written only by the sync.
 * A form that could set it would let an operator advertise a product the
 * supplier has withdrawn, and the customer would meet the failure at quote time.
 */
export function TopUpGameForm({ game }: { game: AdminTopUpGameDetail }) {
  const router = useRouter();
  const [nameFa, setNameFa] = useState(game.nameFa ?? "");
  const [brandName, setBrandName] = useState(game.brandName ?? "");
  const [descriptionFa, setDescriptionFa] = useState(game.descriptionFa ?? "");
  const [providerNote, setProviderNote] = useState(game.providerNote ?? "");
  const [isActive, setIsActive] = useState(game.isActive);
  const [sortOrder, setSortOrder] = useState(String(game.sortOrder));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api.put(`/api/admin/catalog/top-ups/${game.id}`, {
        nameFa: nameFa.trim(),
        brandName: brandName.trim() || null,
        descriptionFa: descriptionFa.trim() || null,
        providerNote: providerNote.trim() || null,
        isActive,
        sortOrder: Number(sortOrder) || 0,
      });
      router.refresh();
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
          نام نمایشی
          <input value={nameFa} onChange={(event) => setNameFa(event.target.value)} required maxLength={240} />
        </label>
        <label>
          برند
          <input value={brandName} onChange={(event) => setBrandName(event.target.value)} maxLength={240} />
        </label>
        <label>
          ترتیب نمایش
          <input value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} type="number" min={0} className="bp-ltr" />
        </label>
        <label>
          وضعیت فروش
          <select value={isActive ? "true" : "false"} onChange={(event) => setIsActive(event.target.value === "true")}>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
        </label>
      </div>
      <div className="form-grid" style={{ marginTop: 13 }}>
        <label>
          توضیح برای مشتری (اختیاری)
          <textarea value={descriptionFa} onChange={(event) => setDescriptionFa(event.target.value)} maxLength={4000} />
        </label>
        <label>
          راهنمای تأمین‌کننده (اختیاری)
          <textarea value={providerNote} onChange={(event) => setProviderNote(event.target.value)} maxLength={4000} className="bp-ltr" />
        </label>
      </div>
      <div className="save-row">
        <button type="submit" className="primary-btn" disabled={pending}>
          {pending ? "در حال ذخیره…" : "ذخیرهٔ تغییرات"}
        </button>
      </div>
    </form>
  );
}
