import Link from "next/link";
import { Badge, Ltr, Timeline, formatJalaliDate } from "@barat/ui";
import type { TimelineStep } from "@barat/ui";
import type { OrderDetailDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { orderStatusView } from "@/lib/status";
import { tomanFromIrr } from "@/app/checkout/purchase";

export const dynamic = "force-dynamic";

/** Statuses at which the order has stopped moving, so no "next step" is implied. */
const TERMINAL = new Set(["FULFILLED", "REFUNDED", "CANCELLED", "FAILED"]);

/** Statuses where the customer can still pay. */
const PAYABLE = new Set(["AWAITING_PAYMENT"]);

export default async function OrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  await requireSession(`/orders/${orderNumber}`);

  let order: OrderDetailDto;
  try {
    order = (await api.order(orderNumber)).order;
  } catch (error) {
    if (!(error instanceof ApiClientError) || !error.isNotFound) throw error;
    return <OrderMissing />;
  }

  const view = orderStatusView(order.status);
  const steps = timelineSteps(order);

  return (
    <main className="page container" style={{ maxWidth: 720 }}>
      <div className="eyebrow">جزئیات سفارش</div>
      <h1 className="h2">
        <Ltr>{order.orderNumber}</Ltr>
      </h1>
      <Badge tone={view.tone} style={{ marginBlockEnd: 20 }}>
        {view.label}
      </Badge>

      {PAYABLE.has(order.status) ? (
        <div className="card pad" style={{ marginBlockEnd: 16 }}>
          <p className="muted" style={{ marginBlockStart: 0 }}>
            این سفارش هنوز پرداخت نشده است. تا زمانی که پرداخت توسط بانک تأیید نشود، آماده‌سازی آغاز نمی‌شود.
          </p>
          <Link className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center" }} href={`/checkout/${order.orderNumber}`}>
            ادامه پرداخت
          </Link>
        </div>
      ) : null}

      <div className="card pad">
        <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 0 }}>
          وضعیت سفارش
        </h2>
        <Timeline steps={steps} />
      </div>

      <div className="card pad" style={{ marginBlockStart: 16 }}>
        <div className="summary-line">
          <span>محصول</span>
          <strong>{order.itemTitleFa}</strong>
        </div>
        <div className="summary-line">
          <span>زمان ثبت</span>
          <strong>{formatJalaliDate(order.createdAt)}</strong>
        </div>
        {order.paidAt !== null ? (
          <div className="summary-line">
            <span>زمان تأیید پرداخت</span>
            <strong>{formatJalaliDate(order.paidAt)}</strong>
          </div>
        ) : null}
        <div className="summary-total">
          <span>{order.paidAt === null ? "مبلغ قابل پرداخت" : "مبلغ پرداختی"}</span>
          <Ltr>{tomanFromIrr(order.totalAmountIrr)}</Ltr>
        </div>
      </div>

      {order.failureReason !== null ? (
        <div className="alert warn" style={{ marginBlockStart: 16 }} role="status">
          {order.failureReason}
        </div>
      ) : null}

      {order.delivery !== null ? <DeliveryCard delivery={order.delivery} /> : null}
    </main>
  );
}

/**
 * What may be shown about a delivered asset.
 *
 * Only `maskedCode` is rendered. The plaintext code and any redemption link
 * that stands in for it are secrets that belong to the audited reveal flow, not
 * to a page a customer might screenshot or leave open.
 */
function DeliveryCard({ delivery }: { readonly delivery: NonNullable<OrderDetailDto["delivery"]> }) {
  return (
    <div className="card pad" style={{ marginBlockStart: 16 }}>
      <h2 className="h2" style={{ fontSize: 20, marginBlockStart: 0 }}>
        تحویل
      </h2>
      {delivery.maskedCode !== null ? (
        <div className="summary-line">
          <span>کد تحویل‌شده</span>
          <strong>
            <Ltr>{delivery.maskedCode}</Ltr>
          </strong>
        </div>
      ) : null}
      {delivery.recipientEmailMasked !== null ? (
        <div className="summary-line">
          <span>ارسال به</span>
          <strong>
            <Ltr>{delivery.recipientEmailMasked}</Ltr>
          </strong>
        </div>
      ) : null}
      {delivery.sentAt !== null ? (
        <div className="summary-line">
          <span>زمان ارسال</span>
          <strong>{formatJalaliDate(delivery.sentAt)}</strong>
        </div>
      ) : null}
      {delivery.expiryDate !== null ? (
        <div className="summary-line">
          <span>اعتبار تا</span>
          <strong>{formatJalaliDate(delivery.expiryDate, "d MMMM yyyy")}</strong>
        </div>
      ) : null}
      <p className="muted" style={{ fontSize: 12, marginBlockEnd: 0 }}>
        کد کامل تنها در صفحهٔ نمایش امن و با ثبت گزارش قابل مشاهده است.
      </p>
    </div>
  );
}

/**
 * The timeline is the server's audited transition list, not a guess. A pending
 * final step is appended only while the order is still in motion, so nothing
 * here promises a delivery the server has not recorded.
 */
function timelineSteps(order: OrderDetailDto): TimelineStep[] {
  const entries = order.timeline.map<TimelineStep>((entry, index) => ({
    id: `${entry.status}-${entry.at}-${index}`,
    title: orderStatusView(entry.status).label,
    ...(entry.noteFa === null ? {} : { description: entry.noteFa }),
    status: index === order.timeline.length - 1 && !TERMINAL.has(order.status) ? "current" : "done",
    timestamp: formatJalaliDate(entry.at),
  }));

  if (TERMINAL.has(order.status)) return entries;
  return [...entries, { id: "pending-fulfilment", title: "تحویل نهایی", status: "pending" }];
}

function OrderMissing() {
  return (
    <main className="page container" style={{ maxWidth: 520 }}>
      <div className="card pad" style={{ textAlign: "center" }}>
        <h1 className="h2">این سفارش پیدا نشد</h1>
        <p className="muted">شماره سفارش را بررسی کنید یا از فهرست سفارش‌هایتان وارد شوید.</p>
        <Link className="btn btn-primary" style={{ marginBlockStart: 18, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href="/orders">
          سفارش‌های من
        </Link>
      </div>
    </main>
  );
}
