"use client";

import { useState } from "react";
import { OFFER_AVAILABILITY_LABELS, type AdminOffer, type AdminSku } from "../../catalog/_lib/catalog-contracts";
import { formatBps, formatCount, formatMoneyAmount } from "../../catalog/_lib/format";
import { ToggleActiveButton } from "../../catalog/_components/toggle-active-button";
import { OfferForm } from "./offer-form";

export function OfferPanel({ supplierId, offers, skus }: { supplierId: string; offers: AdminOffer[]; skus: AdminSku[] }) {
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="card list-card" style={{ marginTop: 16 }}>
      <div className="section-label" style={{ marginTop: 15 }}>
        <h3>Offer های این تأمین‌کننده</h3>
        <span>{formatCount(offers.length)} مورد</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>محصول / SKU</th>
              <th>هزینه</th>
              <th>تخفیف</th>
              <th>اولویت</th>
              <th>موجودی</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <tr key={offer.id}>
                <td>
                  {offer.sku?.product ? `${offer.sku.product.titleFa} — ` : ""}
                  <span className="bp-ltr">{offer.sku?.code ?? offer.skuId}</span>
                </td>
                <td className="bp-ltr">{formatMoneyAmount(offer.costAmount, offer.costCurrency)}</td>
                <td className="bp-ltr">{formatBps(offer.discountBps)}</td>
                <td className="bp-ltr">{formatCount(offer.priority)}</td>
                <td>
                  <span className={`badge ${offer.availability === "AVAILABLE" ? "badge-success" : "badge-danger"}`}>
                    {OFFER_AVAILABILITY_LABELS[offer.availability]}
                  </span>
                </td>
                <td>
                  <span className={`badge ${offer.isActive ? "badge-success" : "badge-danger"}`}>
                    {offer.isActive ? "فعال" : "غیرفعال"}
                  </span>
                </td>
                <td>
                  <span style={{ display: "inline-flex", gap: 8 }}>
                    <button type="button" className="secondary-btn" onClick={() => setEditingId(offer.id)}>
                      ویرایش
                    </button>
                    {offer.isActive ? (
                      <ToggleActiveButton
                        path={`/api/admin/catalog/offers/${offer.id}`}
                        confirmMessage="این Offer غیرفعال شود؟"
                      />
                    ) : null}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {offers.length === 0 ? <p className="empty-hint">هنوز Offer‌ای برای این تأمین‌کننده ثبت نشده است.</p> : null}
      </div>

      {editingId
        ? (() => {
            const editing = offers.find((offer) => offer.id === editingId);
            return editing ? (
              <OfferForm supplierId={supplierId} skus={skus} offer={editing} onDone={() => setEditingId(null)} />
            ) : null;
          })()
        : null}

      {creating ? (
        skus.length === 0 ? (
          <p className="empty-hint">برای افزودن Offer ابتدا باید SKU‌ای در کاتالوگ ثبت شود.</p>
        ) : (
          <OfferForm supplierId={supplierId} skus={skus} onDone={() => setCreating(false)} />
        )
      ) : (
        <div className="save-row" style={{ justifyContent: "flex-start", marginTop: 14 }}>
          <button type="button" className="secondary-btn" onClick={() => setCreating(true)}>
            + افزودن Offer
          </button>
        </div>
      )}
    </div>
  );
}
