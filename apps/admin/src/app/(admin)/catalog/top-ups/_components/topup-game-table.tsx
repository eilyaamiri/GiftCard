"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiClientError, api } from "@/lib/api";
import { bulkSetTopUpGameActiveResultSchema, type AdminTopUpGame } from "../../_lib/catalog-contracts";
import { formatCount } from "../../_lib/format";

/**
 * The top-up game list, with a checkbox per row — the product table's pattern.
 *
 * Bulk changes only the operator's own switch (`isActive`). `isListed` stays
 * the venue's, and the supplier switch and each offer's switch are untouched,
 * so a game activated here still is not sellable until the rest of the chain
 * is on; the «وضعیت فروش» column keeps saying so.
 */
export function TopUpGameTable({
  items,
  emptyHint,
}: {
  items: readonly AdminTopUpGame[];
  emptyHint: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const allSelected = items.length > 0 && selected.length === items.length;

  function toggle(id: string) {
    setDone(null);
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  function toggleAll() {
    setDone(null);
    setSelected(allSelected ? [] : items.map((game) => game.id));
  }

  async function bulkSetActive(isActive: boolean) {
    if (selected.length === 0) return;
    const verb = isActive ? "فعال" : "غیرفعال";
    if (!window.confirm(`${formatCount(selected.length)} بازی ${verb} شود؟`)) return;
    setError(null);
    setDone(null);
    setPending(true);
    try {
      const result = await api.post(
        "/api/admin/catalog/top-ups/bulk-active",
        { gameIds: [...selected], isActive },
        bulkSetTopUpGameActiveResultSchema,
      );
      setSelected([]);
      setDone(`${formatCount(result.updated)} بازی ${verb} شد.`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ارتباط با سرویس ممکن نیست.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card list-card">
      {selected.length > 0 ? (
        <div className="filter-bar" style={{ marginBlock: "14px 4px" }}>
          <strong style={{ fontSize: 11 }}>{formatCount(selected.length)} بازی انتخاب شده</strong>
          <button type="button" className="secondary-btn" onClick={() => bulkSetActive(true)} disabled={pending}>
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
                  aria-label="انتخاب همهٔ بازی‌های این صفحه"
                />
              </th>
              <th>بازی</th>
              <th>تأمین‌کننده</th>
              <th>منطقه</th>
              <th>تعداد بسته</th>
              <th>فهرست تأمین‌کننده</th>
              <th>وضعیت فروش</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((game) => {
              /* The whole chain, resolved here rather than as three separate
               * badges the operator has to combine themselves. */
              const supplierActive = game.supplier?.isActive ?? false;
              const sellable = game.isActive && game.isListed && supplierActive;
              const name = game.nameFa ?? game.name;
              return (
                <tr key={game.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.includes(game.id)}
                      onChange={() => toggle(game.id)}
                      aria-label={`انتخاب ${name}`}
                    />
                  </td>
                  <td>
                    <Link href={`/catalog/top-ups/${game.id}`} className="order-id">
                      {name}
                    </Link>
                    {game.requiresCredentials ? (
                      <span className="badge badge-wait" style={{ marginInlineStart: 8 }}>
                        نیازمند اطلاعات ورود
                      </span>
                    ) : null}
                    <div className="muted bp-ltr" style={{ fontSize: 11 }}>{game.slug}</div>
                  </td>
                  <td>
                    {game.supplier?.name ?? "—"}
                    {game.supplier && !supplierActive ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        تأمین‌کننده غیرفعال است
                      </div>
                    ) : null}
                  </td>
                  <td className="bp-ltr">{game.region ?? "—"}</td>
                  <td>{formatCount(game._count?.offers ?? 0)}</td>
                  <td>
                    <span className={`badge ${game.isListed ? "badge-success" : "badge-danger"}`}>
                      {game.isListed ? "ارائه می‌شود" : "برداشته شده"}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${sellable ? "badge-success" : "badge-danger"}`}>
                      {sellable ? "قابل فروش" : "غیرفعال"}
                    </span>
                    {game.isActive && !sellable ? (
                      <div className="muted" style={{ fontSize: 11 }}>
                        فعال است اما زنجیره کامل نیست
                      </div>
                    ) : null}
                  </td>
                  <td>
                    <Link href={`/catalog/top-ups/${game.id}`} className="secondary-btn taxonomy-cta">
                      مدیریت
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {items.length === 0 ? <p className="empty-hint">{emptyHint}</p> : null}
    </div>
  );
}
