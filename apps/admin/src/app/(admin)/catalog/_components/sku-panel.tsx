"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import {
  DELIVERY_ASSET_TYPE_LABELS,
  bulkSetSkuActiveResultSchema,
  skuOfferCount,
  type AdminSku,
} from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { regionDisplay, regionName } from "../_lib/regions";
import { SkuForm } from "./sku-form";
import { ToggleActiveButton } from "./toggle-active-button";

export function SkuPanel({ productId, skus }: { productId: string; skus: AdminSku[] }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const allSelected = skus.length > 0 && selected.length === skus.length;

  function toggle(id: string) {
    setDone(null);
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleAll() {
    setDone(null);
    setSelected(allSelected ? [] : skus.map((sku) => sku.id));
  }

  /*
   * The same switch the per-row button flips, applied to the selection. Asked
   * first, with the count: activating a SKU makes it orderable, and a batch of
   * them is easier to get wrong than one.
   */
  async function bulkSetActive(isActive: boolean) {
    if (selected.length === 0) return;
    const verb = isActive ? "فعال" : "غیرفعال";
    if (!window.confirm(`${formatCount(selected.length)} SKU انتخاب‌شده ${verb} شود؟`)) return;
    setError(null);
    setDone(null);
    setPending(true);
    try {
      const result = await api.post(
        "/api/admin/catalog/skus/bulk-active",
        { skuIds: [...selected], isActive },
        bulkSetSkuActiveResultSchema,
      );
      setSelected([]);
      setDone(`${formatCount(result.updated)} SKU ${verb} شد.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card list-card" style={{ marginTop: 16 }}>
      <div className="section-label" style={{ marginTop: 15 }}>
        <h3>SKU های این محصول</h3>
        <span>{formatCount(skus.length)} مورد</span>
      </div>

      {selected.length > 0 ? (
        <div className="filter-bar" style={{ marginBlock: "4px 8px" }}>
          <strong style={{ fontSize: 11 }}>{formatCount(selected.length)} SKU انتخاب شده</strong>
          <button type="button" className="primary-btn" onClick={() => bulkSetActive(true)} disabled={pending}>
            {pending ? "در حال اعمال…" : "فعال‌سازی گروهی"}
          </button>
          <button type="button" className="secondary-btn" onClick={() => bulkSetActive(false)} disabled={pending}>
            {pending ? "در حال اعمال…" : "غیرفعال‌سازی گروهی"}
          </button>
          <button type="button" className="filter" onClick={() => setSelected([])} disabled={pending}>
            لغو انتخاب
          </button>
        </div>
      ) : null}
      {error ? (
        <p className="settings-message error" role="alert">
          {error}
        </p>
      ) : null}
      {done ? <p className="settings-message success">{done}</p> : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  disabled={skus.length === 0}
                  aria-label="انتخاب همهٔ SKUهای این محصول"
                />
              </th>
              <th>کد</th>
              <th>منطقه</th>
              <th>مبلغ</th>
              <th>نوع تحویل</th>
              <th>تعداد Offer</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {skus.map((sku) => (
              <tr key={sku.id}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.includes(sku.id)}
                    onChange={() => toggle(sku.id)}
                    aria-label={`انتخاب ${sku.code}`}
                  />
                </td>
                <td className="bp-ltr">{sku.code}</td>
                <td>
                  {/* The supplier's own word, when the list has no name for it: shown as it is, flagged, so it is seen and replaced. */}
                  {regionName(sku.region) === null ? (
                    <>
                      <span className="bp-ltr">{sku.region}</span>{" "}
                      <span className="badge badge-wait" title="این مقدار در فهرست مناطق نیست. با «ویرایش» یک منطقه انتخاب کنید.">
                        منطقه نامشخص
                      </span>
                    </>
                  ) : (
                    regionDisplay(sku.region)
                  )}
                </td>
                <td className="bp-ltr">{sku.denominationLabel}</td>
                <td>{DELIVERY_ASSET_TYPE_LABELS[sku.deliveryAssetType]}</td>
                <td>{formatCount(skuOfferCount(sku))}</td>
                <td>
                  <span className={`badge ${sku.isActive ? "badge-success" : "badge-danger"}`}>
                    {sku.isActive ? "فعال" : "غیرفعال"}
                  </span>
                </td>
                <td>
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <button type="button" className="secondary-btn" onClick={() => setEditingId(sku.id)}>
                      ویرایش
                    </button>
                    {sku.isActive ? (
                      <ToggleActiveButton
                        path={`/api/admin/catalog/skus/${sku.id}`}
                        confirmMessage={`SKU «${sku.code}» غیرفعال شود؟`}
                      />
                    ) : (
                      <ToggleActiveButton
                        path={`/api/admin/catalog/skus/${sku.id}`}
                        confirmMessage={`SKU «${sku.code}» فعال شود؟`}
                        activate
                      />
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {skus.length === 0 ? <p className="empty-hint">هنوز SKU‌ای برای این محصول ثبت نشده است.</p> : null}
      </div>

      {editingId
        ? (() => {
            const editing = skus.find((sku) => sku.id === editingId);
            return editing ? (
              <SkuForm productId={productId} sku={editing} onDone={() => setEditingId(null)} />
            ) : null;
          })()
        : null}

      {creating ? (
        <SkuForm productId={productId} onDone={() => setCreating(false)} />
      ) : (
        <div className="save-row" style={{ justifyContent: "flex-start", marginTop: 14 }}>
          <button type="button" className="secondary-btn" onClick={() => setCreating(true)}>
            + افزودن SKU
          </button>
        </div>
      )}
    </div>
  );
}
