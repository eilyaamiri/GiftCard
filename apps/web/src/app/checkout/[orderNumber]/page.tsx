import Link from "next/link";
import { Badge, Ltr, formatJalaliDate } from "@barat/ui";
import type { OrderDetailDto } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { requireSession } from "@/lib/session";
import { orderStatusView } from "@/lib/status";
import { tomanFromIrr } from "../purchase";
import { StartPayment } from "./start-payment";

export const dynamic = "force-dynamic";

/** Statuses from which starting a payment is still meaningful. */
const PAYABLE = new Set(["AWAITING_PAYMENT", "PAYMENT_PENDING"]);

export default async function CheckoutPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  await requireSession(`/checkout/${orderNumber}`);

  let order: OrderDetailDto;
  try {
    order = (await api.order(orderNumber)).order;
  } catch (error) {
    if (!(error instanceof ApiClientError) || !error.isNotFound) throw error;
    return <OrderMissing />;
  }

  const view = orderStatusView(order.status);
  const payable = PAYABLE.has(order.status);

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="eyebrow">تسویه حساب</div>
      <h1 className="h2">تأیید نهایی سفارش</h1>
      <p className="muted">
        شماره سفارش <Ltr>{order.orderNumber}</Ltr>
      </p>

      <div className="card pad" style={{ marginBlockStart: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBlockEnd: 8 }}>
          <span className="muted" style={{ fontSize: 13 }}>
            وضعیت سفارش
          </span>
          <Badge tone={view.tone}>{view.label}</Badge>
        </div>

        <div className="summary-line">
          <span>محصول</span>
          <strong>{order.itemTitleFa}</strong>
        </div>
        <div className="summary-line">
          <span>زمان ثبت</span>
          <strong>{formatJalaliDate(order.createdAt)}</strong>
        </div>
        {/* The order total is the frozen quote total, copied server-side. */}
        <div className="summary-total">
          <span>مبلغ قابل پرداخت</span>
          <Ltr>{tomanFromIrr(order.totalAmountIrr)}</Ltr>
        </div>

        {payable ? (
          <>
            <div className="alert" style={{ marginBlockStart: 14 }}>
              پس از تأیید پرداخت توسط بانک، سفارش وارد صف آماده‌سازی می‌شود. تا آن لحظه سفارش تحویل‌شده به حساب نمی‌آید.
            </div>
            <StartPayment orderId={order.id} orderNumber={order.orderNumber} />
          </>
        ) : (
          <>
            <div className="alert" style={{ marginBlockStart: 14 }}>
              این سفارش در مرحلهٔ پرداخت نیست. وضعیت آن را از صفحهٔ پیگیری دنبال کنید.
            </div>
            <Link className="btn btn-outline" style={{ width: "100%", marginBlockStart: 18, display: "inline-flex", alignItems: "center", justifyContent: "center" }} href={`/orders/${order.orderNumber}`}>
              پیگیری سفارش
            </Link>
          </>
        )}
      </div>
    </main>
  );
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
