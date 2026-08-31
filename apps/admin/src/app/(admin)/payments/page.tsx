import Link from "next/link";
import type { OrderStatus } from "@barat/contracts";
import { ApiClientError, BACK_OFFICE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import type { OrdersQuery } from "@/lib/order-format";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  PAYMENT_RELEVANT_STATUSES,
  fetchOrders,
  formatCount,
  formatDateTime,
  ordersHref,
  readOrdersQuery,
  tomanFromIrr,
} from "@/lib/order-format";

export const metadata = { title: "پرداخت‌ها | پنل ادمین برات پی" };

/**
 * The API exposes no staff-facing payment endpoint: `/api/payments` is the
 * customer's own create/verify surface and `/api/account/payments` is scoped to
 * a customer session. The only payment facts a staff member can read today are
 * the ones the order carries — status, amount and `paidAt`. So this screen is
 * the payment state of orders, and it says so, rather than inventing gateway
 * attempt records (authority, RefId, masked card) that no endpoint returns.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole(BACK_OFFICE_ROLES);

  // A fulfilment-only status is meaningless here, so it is dropped rather than
  // leaving the filter bar showing "all" while the list is silently narrowed.
  const { status, ...rest } = readOrdersQuery(await searchParams);
  const query: OrdersQuery = isPaymentRelevant(status) ? { ...rest, status } : rest;

  let page;
  try {
    page = await fetchOrders(query);
  } catch (error) {
    if (!(error instanceof ApiClientError)) throw error;
    return (
      <div>
        <Heading />
        <div className="card panel">
          <p className="empty-hint">{error.message}</p>
        </div>
      </div>
    );
  }

  const { items, meta } = page;
  // The API echoes the requested page back, so a hand-typed out-of-range page
  // must be clamped before it reaches the prev/next links.
  const currentPage = Math.min(meta.page, Math.max(meta.totalPages, 1));

  return (
    <div>
      <Heading />

      <p className="warning" style={{ marginBlockEnd: 18 }}>
        این فهرست وضعیت پرداخت سفارش‌ها را از سرویس سفارش‌ها می‌خواند. سرویس فعلی هیچ نقطهٔ پایانی برای فهرست تلاش‌های
        درگاه در اختیار کارکنان قرار نمی‌دهد، بنابراین شمارهٔ Authority، شمارهٔ پیگیری و کارت ماسک‌شده در این صفحه در
        دسترس نیستند. تمام صحت‌سنجی‌ها سمت سرور انجام می‌شود و هیچ پارامتر بازگشتی درگاه مستقیماً پذیرفته نمی‌شود.
      </p>

      <div className="filter-bar">
        <Link
          href={ordersHref("/payments", query, { status: null })}
          className={`filter${query.status === undefined ? " active" : ""}`}
          style={FILTER_LINK}
        >
          همه
        </Link>
        {PAYMENT_RELEVANT_STATUSES.map((status) => (
          <Link
            key={status}
            href={ordersHref("/payments", query, { status })}
            className={`filter${query.status === status ? " active" : ""}`}
            style={FILTER_LINK}
          >
            {ORDER_STATUS_LABEL[status]}
          </Link>
        ))}
      </div>

      <div className="card list-card">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>سفارش</th>
                <th>وضعیت پرداخت</th>
                <th>مبلغ (تومان)</th>
                <th>زمان ثبت</th>
                <th>زمان تأیید پرداخت</th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => (
                <tr key={order.id}>
                  <td>
                    <Link href={`/payments/${order.id}`} className="order-id">
                      {order.orderNumber}
                    </Link>
                  </td>
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
        {items.length === 0 ? <p className="empty-hint">پرداختی با این فیلترها یافت نشد.</p> : null}
      </div>

      {meta.totalPages > 1 ? (
        <div className="filter-bar" style={{ justifyContent: "center", marginBlockStart: 18 }}>
          {currentPage > 1 ? (
            <Link href={ordersHref("/payments", query, { page: currentPage - 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ قبل
            </Link>
          ) : null}
          <span className="muted">
            صفحهٔ {formatCount(currentPage)} از {formatCount(meta.totalPages)}
          </span>
          {currentPage < meta.totalPages ? (
            <Link href={ordersHref("/payments", query, { page: currentPage + 1 })} className="filter" style={FILTER_LINK}>
              صفحهٔ بعد
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Heading() {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">عملیات فروش</p>
        <h1>پرداخت‌ها</h1>
      </div>
      <p className="muted">وضعیت پرداخت سفارش‌ها</p>
    </div>
  );
}

function isPaymentRelevant(status: OrderStatus | undefined): boolean {
  return status !== undefined && (PAYMENT_RELEVANT_STATUSES as readonly OrderStatus[]).includes(status);
}

const FILTER_LINK = {
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
} as const;
