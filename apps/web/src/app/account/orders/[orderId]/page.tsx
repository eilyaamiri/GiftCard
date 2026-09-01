import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Ltr, formatIrr, formatJalaliDate } from "@barat/ui";
import { AccountNav } from "@/components/account-nav";
import { orderStatusView } from "@/lib/status";
import { api, ApiClientError } from "@/lib/api";
import { tomanFromIrr } from "@/app/checkout/purchase";
import { StartPayment } from "@/app/checkout/[orderNumber]/start-payment";

export const dynamic = "force-dynamic";

export default async function AccountOrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;

  /* Another customer's order id answers 404 server-side, so a guessed id leaks
   * nothing — not even that the order exists. */
  const order = await api.accountOrder(orderId).catch((error: unknown) => {
    if (error instanceof ApiClientError && error.isNotFound) notFound();
    throw error;
  });

  const view = orderStatusView(order.status);
  const payable = order.status === "AWAITING_PAYMENT" || order.status === "PAYMENT_PENDING";
  const timeline: ReadonlyArray<{ readonly label: string; readonly at: string | null }> = [
    { label: "ثبت سفارش", at: order.createdAt },
    { label: "پرداخت", at: order.paidAt },
    { label: "تحویل", at: order.fulfilledAt },
  ];

  return (
    <main className="page container" style={{ maxWidth: 760 }}>
      <div className="eyebrow">حساب کاربری</div>
      <h1 className="h2">سفارش <Ltr>{order.orderNumber}</Ltr></h1>
      <AccountNav />

      <div className="card pad">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Badge tone={view.tone}>{view.label}</Badge>
          <Ltr className="price">{tomanFromIrr(order.totalAmountIrr)}</Ltr>
        </div>
        <div className="summary-line" style={{ marginBlockStart: 14 }}>
          <span>مبلغ به ریال</span>
          <strong><Ltr>{formatIrr(BigInt(order.totalAmountIrr))}</Ltr></strong>
        </div>
        <div className="summary-line">
          <span>ارز</span>
          <strong><Ltr>{order.currency}</Ltr></strong>
        </div>
        {timeline.map((step) => (
          <div key={step.label} className="summary-line">
            <span>{step.label}</span>
            <strong>{step.at ? formatJalaliDate(step.at) : "—"}</strong>
          </div>
        ))}
      </div>

      <div className="hero-actions">
        {payable ? (
          <>
            <div className="alert" style={{ flexBasis: "100%" }}>
              پرداخت این نسخه آزمایشی است؛ با انتخاب «پرداخت»، تراکنش فرضی تأیید و سفارش وارد مرحله آماده‌سازی می‌شود.
            </div>
            <div className="account-payment-action">
              <StartPayment
                orderId={order.id}
                orderNumber={order.orderNumber}
                label="پرداخت"
                busyLabel="در حال ثبت پرداخت آزمایشی..."
              />
            </div>
          </>
        ) : null}
        <Link className="btn btn-outline" href="/account/orders">بازگشت به سفارش‌ها</Link>
        <Link className="btn btn-outline" href={`/account/support?orderId=${encodeURIComponent(order.id)}`}>پیگیری این سفارش</Link>
      </div>
    </main>
  );
}
