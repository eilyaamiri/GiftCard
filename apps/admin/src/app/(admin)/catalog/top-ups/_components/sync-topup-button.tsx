"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";
import { ApiClientError, api } from "@/lib/api";
import { topUpSyncResultSchema, type TopUpSyncResult } from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";

const syncEnvelopeSchema = z.object({ result: topUpSyncResultSchema });

/**
 * Runs the venue reconciliation and reports what it found.
 *
 * Unlike every other button in the catalog admin, this one cannot just refresh
 * and move on. The sync's most valuable output is `unknownSkus` — packages the
 * venue sells that our catalogue has no row for. That usually means a ladder
 * entry was added upstream, it is invisible from the storefront, and the
 * operator is the only person who can act on it. So the result is rendered
 * rather than discarded.
 *
 * The run is idempotent and reads only: it writes availability, never a price
 * and never the operator's own activation switch.
 */
export function SyncTopUpButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<TopUpSyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const response = await api.post<{ result: TopUpSyncResult }>(
        "/api/operator/suppliers/topup/sync",
        {},
        syncEnvelopeSchema,
      );
      setResult(response.result);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card panel" style={{ marginBottom: 16 }}>
      <div className="section-label">
        <h3>همگام‌سازی با تأمین‌کننده</h3>
        <span>فقط وضعیت موجودی</span>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        مشخص می‌کند تأمین‌کننده هنوز کدام بسته‌ها را ارائه می‌دهد. قیمت را تغییر نمی‌دهد و کلید فعال‌سازی
        شما را دست نمی‌زند؛ بسته‌ای که تأمین‌کننده دیگر ارائه نمی‌دهد از فروشگاه برداشته می‌شود.
      </p>

      <div className="save-row" style={{ justifyContent: "flex-start" }}>
        <button type="button" className="secondary-btn" disabled={pending} onClick={onClick}>
          {pending ? "در حال همگام‌سازی…" : "اجرای همگام‌سازی"}
        </button>
        {error ? (
          <span className="muted" style={{ color: "var(--red)" }}>
            {error}
          </span>
        ) : null}
      </div>

      {result ? (
        <div style={{ marginTop: 12 }}>
          <p className="muted" style={{ marginTop: 0 }}>
            {result.suppliers.length === 0
              ? "هیچ تأمین‌کنندهٔ قابل همگام‌سازی‌ای پیدا نشد."
              : `${formatCount(result.suppliers.length)} تأمین‌کننده بررسی شد — ` +
                `${formatCount(result.offersListed)} بسته فهرست شد، ` +
                `${formatCount(result.offersDelisted)} بسته برداشته شد.`}
          </p>
          {result.failed.length > 0 ? (
            <p className="muted" style={{ marginTop: 0, color: "var(--red)" }}>
              {/* An unreadable venue is left as it was — never read as "lists nothing". */}
              {`کاتالوگ ${formatCount(result.failed.length)} تأمین‌کننده دریافت نشد و وضعیتش تغییری نکرد: `}
              <span className="bp-ltr">
                {result.failed
                  .map((failure) => (failure.code ? `${failure.supplierCode} (${failure.code})` : failure.supplierCode))
                  .join("، ")}
              </span>
            </p>
          ) : null}
          {result.unknownSkus.length > 0 ? (
            <div className="card panel" style={{ marginTop: 10, borderColor: "var(--amber, #d97706)" }}>
              {/* The one finding an operator cannot get anywhere else. */}
              <strong>بسته‌هایی که تأمین‌کننده دارد و ما نداریم</strong>
              <p className="muted" style={{ marginTop: 4 }}>
                این‌ها در فروشگاه دیده نمی‌شوند. معمولاً یعنی بستهٔ تازه‌ای upstream اضافه شده و
                باید در کاتالوگ ثبت شود.
              </p>
              <ul className="bp-ltr" style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
                {result.unknownSkus.map((sku) => (
                  <li key={sku}>{sku}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
