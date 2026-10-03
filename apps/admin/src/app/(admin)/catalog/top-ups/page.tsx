import Link from "next/link";
import { ApiClientError, CATALOG_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  adminSupplierListSchema,
  adminTopUpGameListSchema,
  readTopUpQuery,
  topUpHref,
  topUpListSearch,
  type AdminSupplier,
} from "../_lib/catalog-contracts";
import { formatCount } from "../_lib/format";
import { CatalogTabs } from "../_components/catalog-tabs";
import { ImportTopUpButton } from "./_components/import-topup-button";
import { SyncTopUpButton } from "./_components/sync-topup-button";
import { TopUpGameTable } from "./_components/topup-game-table";

export const metadata = { title: "شارژ مستقیم | پنل ادمین سنتو" };

const BASE_PATH = "/catalog/top-ups";

/**
 * The direct top-up catalogue.
 *
 * A game here is sellable only when three switches are all on — its own, its
 * supplier's, and each individual offer's — plus `isListed`, which the venue
 * owns. All four are on this screen because a game stuck at "unavailable" with
 * one of them off is the failure this page exists to make findable.
 *
 * An import brings in hundreds of games, so the list is paged and filtered
 * like the product list, with its state in the URL.
 */
export default async function TopUpCatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(CATALOG_WRITE_ROLES);

  const query = readTopUpQuery(await searchParams);

  let list;
  let suppliers: AdminSupplier[];
  try {
    /* `status` is always sent (default ALL): a synced game arrives inactive on
     * purpose, so hiding inactive rows would hide the entire review queue. */
    const [games, supplierList] = await Promise.all([
      api.get(`/api/admin/catalog/top-ups${topUpListSearch(query)}`, adminTopUpGameListSchema),
      api.get("/api/admin/catalog/suppliers?pageSize=100&includeInactive=true", adminSupplierListSchema),
    ]);
    list = games;
    suppliers = supplierList.items;
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

  const { items, meta } = list;
  /* The API echoes a hand-typed `?page=999`; clamp so the caption and pager stay honest. */
  const currentPage = Math.min(meta.page, Math.max(meta.totalPages, 1));
  const firstRow = items.length === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastRow = firstRow + items.length - 1;
  const hasFilter =
    Boolean(query.search) ||
    Boolean(query.supplierId) ||
    query.status !== "ALL" ||
    query.listed !== "ALL" ||
    query.credentials !== "ALL";

  return (
    <div>
      <PageHeading
        caption={
          items.length === 0
            ? "بازی‌ای یافت نشد"
            : `نمایش ${formatCount(firstRow)}–${formatCount(lastRow)} از ${formatCount(meta.total)} بازی`
        }
      />
      <CatalogTabs active="topups" />

      <ImportTopUpButton />
      <SyncTopUpButton />

      <div className="toolbar">
        <form action={BASE_PATH} method="get" className="filter-bar" style={{ marginBlockEnd: 0 }}>
          <div className="search">
            <input
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder="نام، شناسه یا منطقهٔ بازی"
              maxLength={120}
              aria-label="جست‌وجوی بازی"
            />
          </div>
          <label className="filter" style={INLINE_FILTER}>
            تأمین‌کننده
            <select name="supplierId" defaultValue={query.supplierId ?? ""} aria-label="فیلتر تأمین‌کننده">
              <option value="">همهٔ تأمین‌کننده‌ها</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </label>
          <label className="filter" style={INLINE_FILTER}>
            وضعیت
            <select name="status" defaultValue={query.status} aria-label="فیلتر وضعیت بازی">
              <option value="ALL">همهٔ بازی‌ها</option>
              <option value="ACTIVE">فقط فعال‌ها</option>
              <option value="INACTIVE">فقط غیرفعال‌ها</option>
            </select>
          </label>
          <label className="filter" style={INLINE_FILTER}>
            فهرست تأمین‌کننده
            <select name="listed" defaultValue={query.listed} aria-label="فیلتر فهرست تأمین‌کننده">
              <option value="ALL">همه</option>
              <option value="LISTED">ارائه می‌شود</option>
              <option value="DELISTED">برداشته شده</option>
            </select>
          </label>
          <label className="filter" style={INLINE_FILTER}>
            اطلاعات ورود
            <select name="credentials" defaultValue={query.credentials} aria-label="فیلتر نیاز به اطلاعات ورود">
              <option value="ALL">همه</option>
              <option value="NO">فقط شناسهٔ بازیکن</option>
              <option value="YES">نیازمند اطلاعات ورود</option>
            </select>
          </label>
          <button type="submit" className="filter">
            جست‌وجو
          </button>
          {hasFilter ? (
            <Link href={BASE_PATH} className="filter" style={FILTER_LINK}>
              پاک کردن فیلترها
            </Link>
          ) : null}
        </form>
      </div>

      <TopUpGameTable
        items={items}
        emptyHint={
          hasFilter
            ? "با این فیلترها بازی‌ای یافت نشد."
            : "هنوز بازی شارژ مستقیمی ثبت نشده است. ابتدا بازی‌ها را از تأمین‌کننده وارد کنید."
        }
      />

      {meta.totalPages > 1 ? (
        <div className="filter-bar" style={{ justifyContent: "center", marginBlockStart: 18 }}>
          {currentPage > 1 ? (
            <Link href={topUpHref(BASE_PATH, query, { page: currentPage - 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ قبل
            </Link>
          ) : null}
          <span className="muted">
            صفحهٔ {formatCount(currentPage)} از {formatCount(meta.totalPages)}
          </span>
          {currentPage < meta.totalPages ? (
            <Link href={topUpHref(BASE_PATH, query, { page: currentPage + 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ بعد
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PageHeading({ caption }: { caption?: string }) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">کاتالوگ و تأمین</p>
        <h1>شارژ مستقیم</h1>
      </div>
      <p className="muted">{caption ?? ""}</p>
    </div>
  );
}

const INLINE_FILTER = { display: "inline-flex", alignItems: "center", gap: 7 } as const;

/** `.filter` is styled for buttons; an anchor needs the box model spelled out. */
const FILTER_LINK = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;
