import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { adminTopUpGameListSchema } from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { CatalogTabs } from "../_components/catalog-tabs";
import { ImportTopUpButton } from "./_components/import-topup-button";
import { SyncTopUpButton } from "./_components/sync-topup-button";

export const metadata = { title: "شارژ مستقیم | پنل ادمین برات پی" };

/**
 * The direct top-up catalogue.
 *
 * A game here is sellable only when three switches are all on — its own, its
 * supplier's, and each individual offer's — plus `isListed`, which the venue
 * owns. All four are on this screen because a game stuck at "unavailable" with
 * one of them off is the failure this page exists to make findable.
 */
export default async function TopUpCatalogPage() {
  await requireRole(CATALOG_WRITE_ROLES);

  let list;
  try {
    /* `includeInactive=true` always: a synced game arrives inactive on purpose,
     * so hiding inactive rows would hide the entire review queue. */
    list = await api.get(
      "/api/admin/catalog/top-ups?pageSize=100&includeInactive=true",
      adminTopUpGameListSchema,
    );
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <PageHeading />
        <CatalogTabs active="topups" />
        <div className="card panel">
          <p className="empty-hint">{error.message}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeading count={list.meta.total} />
      <CatalogTabs active="topups" />

      <ImportTopUpButton />
      <SyncTopUpButton />

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
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
              {list.items.map((game) => {
                /* The whole chain, resolved here rather than as three separate
                 * badges the operator has to combine themselves. */
                const supplierActive = game.supplier?.isActive ?? false;
                const sellable = game.isActive && game.isListed && supplierActive;
                return (
                  <tr key={game.id}>
                    <td>
                      <Link href={`/catalog/top-ups/${game.id}`} className="order-id">
                        {game.nameFa ?? game.name}
                      </Link>
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
                      <Link
                        href={`/catalog/top-ups/${game.id}`}
                        className="secondary-btn"
                        style={{ display: "inline-flex", alignItems: "center", textDecoration: "none" }}
                      >
                        مدیریت
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {list.items.length === 0 ? (
          <p className="empty-hint">
            هنوز بازی شارژ مستقیمی ثبت نشده است. ابتدا بازی‌ها را از تأمین‌کننده وارد کنید.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PageHeading({ count }: { count?: number }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>شارژ مستقیم</h1>
      </div>
      <p className="muted">{count === undefined ? "" : `${formatCount(count)} بازی`}</p>
    </div>
  );
}
