"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiClientError, api } from "@/lib/api";
import { mergeBrandsResultSchema, type AdminBrand, type AdminBrandOption } from "../../_lib/catalog-contracts";
import { FormError } from "../../_components/form-error";

/**
 * Folds this brand into another one.
 *
 * The supplier feeds ship the same brand under several spellings and the import
 * cannot always tell. Merging moves the products across first and only then
 * removes the emptied brand — nothing in the catalog is lost, which is why this
 * exists instead of an operator deactivating the duplicate.
 */
export function MergeBrandsForm({
  brand,
  options,
}: {
  brand: AdminBrand;
  options: readonly AdminBrandOption[];
}) {
  const router = useRouter();
  const [targetBrandId, setTargetBrandId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const productCount = brand._count?.products ?? 0;
  const target = options.find((option) => option.id === targetBrandId);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target) return;
    const confirmed = window.confirm(
      `${productCount.toLocaleString("fa-IR")} محصول از «${brand.nameFa}» به «${target.nameFa}» منتقل می‌شود` +
        ` و برند «${brand.nameFa}» حذف خواهد شد. ادامه می‌دهید؟`,
    );
    if (!confirmed) return;

    setError(null);
    setPending(true);
    try {
      const result = await api.post(
        "/api/admin/catalog/brands/merge",
        { sourceBrandId: brand.id, targetBrandId: target.id },
        mergeBrandsResultSchema,
      );
      router.push(`/catalog/brands/${result.targetBrandId}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="card panel" style={{ marginTop: 18 }}>
      <div className="panel-heading">
        <h2 className="panel-title">ادغام با برند دیگر</h2>
        <p className="panel-caption">
          محصول‌ها منتقل می‌شوند و هیچ محصولی حذف نمی‌شود؛ فقط برند تکراری برداشته می‌شود.
        </p>
      </div>
      <FormError message={error} />
      <div className="form-grid">
        <label>
          انتقال محصول‌های «{brand.nameFa}» به
          <select value={targetBrandId} onChange={(event) => setTargetBrandId(event.target.value)} required>
            <option value="">یک برند انتخاب کنید…</option>
            {options
              .filter((option) => option.id !== brand.id)
              .map((option) => (
                <option key={option.id} value={option.id}>
                  {option.nameFa} — {option.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="save-row">
        <button type="submit" className="secondary-btn settings-danger" disabled={pending || !target}>
          {pending ? "در حال ادغام…" : "ادغام برند"}
        </button>
      </div>
    </form>
  );
}
