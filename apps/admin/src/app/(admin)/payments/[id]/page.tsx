import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, BACK_OFFICE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  failureReasonLabel,
  fetchOrder,
  formatDateTime,
  formatOptionalDateTime,
  irrLabel,
  tomanFromIrr,
} from "@/lib/order-format";

export const metadata = { title: "جزئیات پرداخت | پنل ادمین برات پی" };

/**
 * Keyed by order id, because the order is the only payment record staff can
 * read. There is no `GET /api/admin/payments/:id`, so a gateway attempt cannot
 * be opened on its own and none of its fields are shown as if they were.
 */
export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(BACK_OFFICE_ROLES);
  const { id } = await params;

  let order;
  try {
    ({ order } = await fetchOrder(id));
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }

  return (
    <div>
      <p className="breadcrumb">
        <Link href="/payments">پرداخت‌ها</Link>
        <span>/</span>
        <span className="order-id">{order.orderNumber}</span>
      </p>

      <div className="page-heading">
        <div>
          <p className="eyebrow">وضعیت پرداخت سفارش</p>
          <h1 className="order-id">{order.orderNumber}</h1>
        </div>
        <span className={`badge ${ORDER_STATUS_BADGE[order.status]}`}>{ORDER_STATUS_LABEL[order.status]}</span>
      </div>

      <div className="two-col">
        <div className="card panel">
          <div className="panel-heading">
            <h2 className="panel-title">مبلغ</h2>
          </div>
          <div className="kv-list">
            <div className="kv-row">
              <span>مبلغ قابل پرداخت (تومان)</span>
              <span>{tomanFromIrr(order.totalAmountIrr)}</span>
            </div>
            <div className="kv-row">
              <span>مبلغ ثبت‌شده (ریال)</span>
              <span className="bp-ltr">{irrLabel(order.totalAmountIrr)}</span>
            </div>
            <div className="kv-row">
              <span>ارز</span>
              <span className="bp-ltr">{order.currency}</span>
            </div>
          </div>

          <div className="panel-heading" style={{ marginBlockStart: 22 }}>
            <h2 className="panel-title">زمان‌بندی</h2>
          </div>
          <div className="kv-list">
            <div className="kv-row">
              <span>ثبت سفارش</span>
              <span>{formatDateTime(order.createdAt)}</span>
            </div>
            <div className="kv-row">
              <span>تأیید پرداخت</span>
              <span>{formatOptionalDateTime(order.paidAt)}</span>
            </div>
            <div className="kv-row">
              <span>لغو</span>
              <span>{formatOptionalDateTime(order.cancelledAt)}</span>
            </div>
            <div className="kv-row">
              <span>علت ناموفق بودن</span>
              <span>{failureReasonLabel(order.failureReason)}</span>
            </div>
          </div>
        </div>

        <div className="card panel">
          <div className="panel-heading">
            <h2 className="panel-title">اطلاعات درگاه</h2>
          </div>
          <p className="empty-hint">
            سرویس فعلی هیچ نقطهٔ پایانی برای خواندن تلاش‌های درگاه توسط کارکنان ندارد؛ بنابراین شمارهٔ Authority، شمارهٔ
            پیگیری بانک و کارت ماسک‌شده در دسترس نیستند.
          </p>
          <div className="kv-list" style={{ marginBlockStart: 8 }}>
            <div className="kv-row">
              <span>شناسهٔ سفارش</span>
              <span className="bp-ltr">{order.id}</span>
            </div>
            <div className="kv-row">
              <span>شناسهٔ استعلام</span>
              <span className="bp-ltr">{order.quoteId}</span>
            </div>
            <div className="kv-row">
              <span>شناسهٔ مشتری</span>
              <span className="bp-ltr">{order.customerId}</span>
            </div>
            <div className="kv-row">
              <span>سفارش مرتبط</span>
              <span>
                <Link href={`/orders/${order.id}`}>مشاهدهٔ سفارش</Link>
              </span>
            </div>
          </div>
          <p className="warning" style={{ marginBlockStart: 16 }}>
            هیچ توکن پرداخت، رمز API یا مقدار OTP در این صفحه یا در لاگ‌های سرور نمایش داده نمی‌شود. تنها شمارهٔ کارت
            ماسک‌شده مجاز به نمایش است.
          </p>
        </div>
      </div>
    </div>
  );
}
