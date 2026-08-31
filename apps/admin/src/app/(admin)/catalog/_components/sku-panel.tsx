"use client";

import { useState } from "react";
import { DELIVERY_ASSET_TYPE_LABELS, skuOfferCount, type AdminSku } from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { SkuForm } from "./sku-form";
import { ToggleActiveButton } from "./toggle-active-button";

export function SkuPanel({ productId, skus }: { productId: string; skus: AdminSku[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="card list-card" style={{ marginTop: 16 }}>
      <div className="section-label" style={{ marginTop: 15 }}>
        <h3>SKU های این محصول</h3>
        <span>{formatCount(skus.length)} مورد</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>کد</th>
              <th>Region</th>
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
                <td className="bp-ltr">{sku.code}</td>
                <td className="bp-ltr">{sku.region}</td>
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
                    ) : null}
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
