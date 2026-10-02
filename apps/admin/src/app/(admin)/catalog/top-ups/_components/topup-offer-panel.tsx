"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import type { AdminTopUpOffer } from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";

/**
 * The packages a customer can buy, each with its own switch.
 *
 * Deliberately has no cost column. A top-up's price is a live read of the
 * venue's rate at quote time, and `TopUpOffer.costAmount` is `0` in practice —
 * rendering it beside a gift-card offer's real cost would invite an operator to
 * treat the two as the same thing. What is editable is what the operator
 * actually owns: whether it is on sale, what it is called, and its order.
 */
export function TopUpOfferPanel({ offers }: { offers: AdminTopUpOffer[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setActive(offer: AdminTopUpOffer, isActive: boolean) {
    setPendingId(offer.id);
    setError(null);
    try {
      await api.put(`/api/admin/catalog/top-up-offers/${offer.id}`, { isActive });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="card list-card" style={{ marginTop: 16 }}>
      <div className="section-label" style={{ marginTop: 15 }}>
        <h3>بسته‌های این بازی</h3>
        <span>{formatCount(offers.length)} مورد</span>
      </div>

      {error ? (
        <p className="muted" style={{ color: "var(--red)", marginInline: 15 }}>
          {error}
        </p>
      ) : null}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>بسته</th>
              <th>شناسهٔ تأمین‌کننده</th>
              <th>فهرست تأمین‌کننده</th>
              <th>وضعیت</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {offers.map((offer) => (
              <tr key={offer.id}>
                <td>{offer.nameFa ?? offer.name}</td>
                <td className="bp-ltr">{offer.providerOfferId}</td>
                <td>
                  <span className={`badge ${offer.isListed ? "badge-success" : "badge-danger"}`}>
                    {offer.isListed ? "ارائه می‌شود" : "برداشته شده"}
                  </span>
                </td>
                <td>
                  <span className={`badge ${offer.isActive ? "badge-success" : "badge-danger"}`}>
                    {offer.isActive ? "فعال" : "غیرفعال"}
                  </span>
                </td>
                <td>
                  <button
                    type="button"
                    className="secondary-btn"
                    disabled={pendingId === offer.id}
                    onClick={() => void setActive(offer, !offer.isActive)}
                  >
                    {pendingId === offer.id ? "در حال انجام…" : offer.isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {offers.length === 0 ? (
          <p className="empty-hint">هنوز بسته‌ای برای این بازی ثبت نشده است.</p>
        ) : null}
      </div>

      <p className="muted" style={{ marginInline: 15, fontSize: 11 }}>
        بسته‌ای که تأمین‌کننده برداشته باشد («برداشته شده») حتی با فعال بودن، به مشتری نمایش داده نمی‌شود.
      </p>
    </div>
  );
}
