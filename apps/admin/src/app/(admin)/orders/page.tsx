import Link from "next/link";
import type { OrderStatus } from "@barat/contracts";
import { ApiClientError, BACK_OFFICE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  formatCount,
  formatDateTime,
  fetchOrders,
  ordersHref,
  readOrdersQuery,
  tomanFromIrr,
} from "@/lib/order-format";

export const metadata = { title: "سفارش‌ها | پنل ادمین برات پی" };

/** The statuses worth one click. The rest stay reachable through the URL. */
const QUICK_FILTERS = [
  "AWAITING_PAYMENT",
  "PAID",
  "FULFILLING",
  "FULFILLED",
  "FAILED",
  "REFUNDED",
] as const satisfies readonly OrderStatus[];

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(BACK_OFFICE_ROLES);

  const query = readOrdersQuery(await searchParams);

  let page;
  try {
    page = await fetchOrders(query);
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <div className="page-heading">
          <div>
            <p className="eyebrow">عملیات فروش</p>
            <h1>سفارش‌ها</h1>
          </div>
        </div>
        <div className="card panel">
          <p className="empty-hint">{error.message}</p>
        </div>
      </div>
    );
  }

  const { items, meta } = page;
  // The API echoes back whatever page was asked for, so a hand-typed `?page=999`
  // comes back empty with page 999 in the meta. Clamping keeps the range caption
  // and the prev/next links honest instead of reporting rows 19,961–80 of 80.
  const currentPage = Math.min(meta.page, Math.max(meta.totalPages, 1));
  const firstRow = items.length === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastRow = firstRow + items.length - 1;

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">عملیات فروش</p>
          <h1>سفارش‌ها</h1>
        </div>
        <p className="muted">
          {items.length === 0
            ? "سفارشی با این فیلترها یافت نشد"
            : `نمایش ${formatCount(firstRow)}–${formatCount(lastRow)} از ${formatCount(meta.total)} سفارش`}
        </p>
      </div>

      <div className="toolbar">
        <div className="filter-bar" style={{ marginBlockEnd: 0 }}>
          <Link
            href={ordersHref("/orders", query, { status: null })}
            className={`filter${query.status === undefined ? " active" : ""}`}
            style={FILTER_LINK}
          >
            همه
          </Link>
          {QUICK_FILTERS.map((status) => (
            <Link
              key={status}
              href={ordersHref("/orders", query, { status })}
              className={`filter${query.status === status ? " active" : ""}`}
              style={FILTER_LINK}
            >
              {ORDER_STATUS_LABEL[status]}
            </Link>
          ))}
        </div>

        {/* A plain GET form: the filter state stays in the URL, so it survives a
            reload, is shareable, and needs no client-side JavaScript. */}
        <form action="/orders" method="get" className="filter-bar" style={{ marginBlockEnd: 0 }}>
          {query.status ? <input type="hidden" name="status" value={query.status} /> : null}
          <div className="search">
            <input
              type="search"
              name="search"
              defaultValue={query.search ?? ""}
              placeholder="شمارهٔ سفارش یا شناسهٔ مشتری"
              maxLength={120}
              aria-label="جست‌وجوی سفارش"
            />
          </div>
          <button type="submit" className="filter">
            جست‌وجو
          </button>
          {query.search ? (
            <Link href={ordersHref("/orders", query, { search: "" })} className="filter" style={FILTER_LINK}>
              پاک کردن
            </Link>
          ) : null}
        </form>
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>شمارهٔ سفارش</th>
                <th>محصول</th>
                <th>وضعیت</th>
                <th>مبلغ (تومان)</th>
                <th>زمان ثبت</th>
                <th>زمان پرداخت</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link href={`/orders/${order.id}`} className="order-id">
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td>{order.itemTitleFa}</td>
                  <td>
                    <span className={`badge ${ORDER_STATUS_BADGE[order.status]}`}>
                      {ORDER_STATUS_LABEL[order.status]}
                    </span>
                  </td>
                  <td>{tomanFromIrr(order.totalAmountIrr)}</td>
                  <td className="muted">{formatDateTime(order.createdAt)}</td>
                  <td className="muted">{order.paidAt === null ? "—" : formatDateTime(order.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {items.length === 0 ? <p className="empty-hint">سفارشی با این فیلترها یافت نشد.</p> : null}
      </div>

      {meta.totalPages > 1 ? (
        <div className="filter-bar" style={{ justifyContent: "center", marginBlockStart: 18 }}>
          {currentPage > 1 ? (
            <Link href={ordersHref("/orders", query, { page: currentPage - 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ قبل
            </Link>
          ) : null}
          <span className="muted">
            صفحهٔ {formatCount(currentPage)} از {formatCount(meta.totalPages)}
          </span>
          {currentPage < meta.totalPages ? (
            <Link href={ordersHref("/orders", query, { page: currentPage + 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ بعد
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** `.filter` is styled for buttons; an anchor needs the box model spelled out. */
const FILTER_LINK = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;
