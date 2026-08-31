import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiClientError, BACK_OFFICE_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  DELIVERY_ASSET_TYPE_LABEL,
  DELIVERY_STATUS_BADGE,
  DELIVERY_STATUS_LABEL,
  ORDER_STATUS_BADGE,
  ORDER_STATUS_LABEL,
  failureReasonLabel,
  fetchOrder,
  formatDateTime,
  formatOptionalDateTime,
  irrLabel,
  tomanFromIrr,
} from "@/lib/order-format";

export const metadata = { title: "جزئیات سفارش | پنل ادمین برات پی" };

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireRole(BACK_OFFICE_ROLES);
  const { id } = await params;

  let order;
  try {
    ({ order } = await fetchOrder(id));
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 404) notFound();
    throw error;
  }

  const { delivery } = order;

  return (
    <div>
      <p className="breadcrumb">
        <Link href="/orders">سفارش‌ها</Link>
        <span>/</span>
        <span className="order-id">{order.orderNumber}</span>
      </p>

      <div className="page-heading">
        <div>
          <p className="eyebrow">جزئیات سفارش</p>
          <h1 className="order-id">{order.orderNumber}</h1>
        </div>
        <span className={`badge ${ORDER_STATUS_BADGE[order.status]}`}>{ORDER_STATUS_LABEL[order.status]}</span>
      </div>

      <div className="stat-strip">
        <div className="card stat-tile">
          <span>محصول</span>
          <strong style={{ fontSize: 14 }}>{order.itemTitleFa}</strong>
        </div>
        <div className="card stat-tile">
          <span>مبلغ کل (تومان)</span>
          <strong>{tomanFromIrr(order.totalAmountIrr)}</strong>
        </div>
        <div className="card stat-tile">
          <span>مبلغ ثبت‌شده (ریال)</span>
          <strong style={{ fontSize: 14 }}>{irrLabel(order.totalAmountIrr)}</strong>
        </div>
        <div className="card stat-tile">
          <span>زمان ثبت</span>
          <strong style={{ fontSize: 14 }}>{formatDateTime(order.createdAt)}</strong>
        </div>
      </div>

      <div className="two-col">
        <div className="card panel">
          <div className="panel-heading">
            <h2 className="panel-title">جدول زمانی سفارش</h2>
          </div>
          {order.timeline.length === 0 ? (
            <>
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
                  <span>تحویل</span>
                  <span>{formatOptionalDateTime(order.fulfilledAt)}</span>
                </div>
                <div className="kv-row">
                  <span>لغو</span>
                  <span>{formatOptionalDateTime(order.cancelledAt)}</span>
                </div>
              </div>
              <p className="empty-hint" style={{ paddingBlock: 16 }}>
                رخداد وضعیتی برای این سفارش ثبت نشده است؛ زمان‌های بالا از خود سفارش خوانده شده‌اند.
              </p>
            </>
          ) : (
            <div className="timeline">
              {order.timeline.map((step) => (
                <div className="timeline-row" key={`${step.status}-${step.at}`}>
                  <span className="timeline-dot" />
                  <div className="timeline-copy">
                    <strong>{ORDER_STATUS_LABEL[step.status]}</strong>
                    <span>{formatDateTime(step.at)}</span>
                    {step.noteFa === null ? null : <span>{step.noteFa}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="card panel">
            <div className="panel-heading">
              <h2 className="panel-title">اطلاعات مرتبط</h2>
            </div>
            <div className="kv-list">
              <div className="kv-row">
                <span>شناسهٔ سفارش</span>
                <span className="bp-ltr">{order.id}</span>
              </div>
              <div className="kv-row">
                <span>شناسهٔ استعلام</span>
                <span className="bp-ltr">{order.quoteId}</span>
              </div>
              <div className="kv-row">
                <span>شناسهٔ سبد</span>
                <span className="bp-ltr">{order.cartId ?? "—"}</span>
              </div>
              <div className="kv-row">
                <span>شناسهٔ مشتری</span>
                <span className="bp-ltr">
                  <Link href={`/orders?search=${encodeURIComponent(order.customerId)}`}>{order.customerId}</Link>
                </span>
              </div>
              <div className="kv-row">
                <span>ارز</span>
                <span className="bp-ltr">{order.currency}</span>
              </div>
              <div className="kv-row">
                <span>علت ناموفق بودن</span>
                <span>{failureReasonLabel(order.failureReason)}</span>
              </div>
            </div>
          </div>

          <div className="card panel">
            <div className="panel-heading">
              <h2 className="panel-title">تحویل</h2>
              {delivery === null ? null : (
                <span className={`badge ${DELIVERY_STATUS_BADGE[delivery.status]}`}>
                  {DELIVERY_STATUS_LABEL[delivery.status]}
                </span>
              )}
            </div>
            {delivery === null ? (
              <p className="empty-hint">هنوز محموله‌ای برای این سفارش ثبت نشده است.</p>
            ) : (
              <>
                <div className="kv-list">
                  <div className="kv-row">
                    <span>نوع دارایی</span>
                    <span>{DELIVERY_ASSET_TYPE_LABEL[delivery.assetType]}</span>
                  </div>
                  <div className="kv-row">
                    <span>کد (ماسک‌شده)</span>
                    <span className="bp-ltr">{delivery.maskedCode ?? "—"}</span>
                  </div>
                  <div className="kv-row">
                    <span>لینک بازخرید</span>
                    <span>{delivery.deliveryUrl === null ? "—" : "ثبت شده است"}</span>
                  </div>
                  <div className="kv-row">
                    <span>گیرنده (ماسک‌شده)</span>
                    <span className="bp-ltr">{delivery.recipientEmailMasked ?? "—"}</span>
                  </div>
                  <div className="kv-row">
                    <span>زمان ارسال</span>
                    <span>{formatOptionalDateTime(delivery.sentAt)}</span>
                  </div>
                  <div className="kv-row">
                    <span>تاریخ انقضا</span>
                    <span>{formatOptionalDateTime(delivery.expiryDate)}</span>
                  </div>
                </div>
                {/* A redemption link is a bearer secret exactly like the code is,
                    so only its presence is reported here. Both are released only
                    through the reveal flow, which writes an audit entry. */}
                <p className="warning" style={{ marginBlockStart: 16 }}>
                  کد کامل گیفت کارت و لینک بازخرید در این صفحه نمایش داده نمی‌شوند. افشای کد تنها از مسیر اختصاصی
                  «نمایش کد» انجام می‌شود و در گزارش رخدادها ثبت می‌گردد.
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
