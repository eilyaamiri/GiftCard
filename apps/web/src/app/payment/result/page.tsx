"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Ltr } from "@barat/ui";
import type { OrderDetailDto, PaymentDto } from "@barat/contracts";
import { CheckCircle2, HelpCircle, Loader2, RefreshCw, XCircle } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import { tomanFromIrr, verifyPayment } from "@/app/checkout/purchase";
import { orderStatusView, paymentFailureText, paymentStatusView } from "@/lib/status";

/**
 * The payment result.
 *
 * The query string is UNTRUSTED gateway input. `Status=OK` is never read as an
 * outcome — it is not read at all. The only thing taken from the URL is which
 * payment and which order to ask the server about, and the server's answer is
 * the entire truth of this page.
 */
function ResultContent() {
  const params = useSearchParams();
  const paymentId = params.get("payment");
  const orderNumber = params.get("order");

  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const started = useRef(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      if (paymentId !== null) {
        const verified = await verifyPayment(paymentId);
        setPayment(verified.payment);
        setMessage(verified.messageFa);
      }
    } catch (error) {
      setMessage(error instanceof ApiClientError ? error.message : "در حال بررسی نتیجه با بانک هستیم.");
    }
    try {
      /* The order is asked for separately: a verified payment is not yet a
       * delivered order, and the order row is what says where it actually is. */
      if (orderNumber !== null) setOrder((await api.order(orderNumber)).order);
    } catch {
      /* A missing order does not change the payment outcome shown above. */
    }
    setChecking(false);
  }, [paymentId, orderNumber]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void check();
  }, [check]);

  const settled = payment !== null && payment.status === "PAID";
  const failed = payment !== null && (payment.status === "FAILED" || payment.status === "CANCELLED");
  const undecided = !settled && !failed;

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="card pad" style={{ padding: 32, textAlign: "center" }}>
        {checking && payment === null ? (
          <>
            <Loader2 className="animate-spin" size={44} style={{ color: "var(--teal)", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" />
            <h1 className="h2">در حال بررسی نتیجه پرداخت</h1>
            <p className="muted">لطفاً این صفحه را نبندید.</p>
          </>
        ) : (
          <>
            {settled ? <CheckCircle2 size={44} style={{ color: "var(--green)", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" /> : failed ? <XCircle size={44} style={{ color: "#D94A4A", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" /> : <HelpCircle size={44} style={{ color: "var(--amber)", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" />}
            <h1 className="h2">{settled ? "پرداخت شما تأیید شد" : failed ? "پرداخت انجام نشد" : "نتیجهٔ پرداخت هنوز قطعی نشده است"}</h1>
            {payment !== null ? (
              <Badge tone={paymentStatusView(payment.status).tone} style={{ marginBlockEnd: 12 }}>
                {paymentStatusView(payment.status).label}
              </Badge>
            ) : null}
            <p className="muted">{paymentFailureText(payment?.failureReason ?? null) ?? message ?? "به‌محض مشخص شدن نتیجه به شما اطلاع می‌دهیم."}</p>
          </>
        )}

        {payment !== null ? (
          <div style={{ marginBlockStart: 20, textAlign: "start" }}>
            <div className="summary-line">
              <span>مبلغ</span>
              <strong>
                <Ltr>{tomanFromIrr(payment.amountIrr)}</Ltr>
              </strong>
            </div>
            {settled && payment.providerRefId !== null ? (
              <div className="summary-line">
                <span>شماره پیگیری بانک</span>
                <strong>
                  <Ltr>{payment.providerRefId}</Ltr>
                </strong>
              </div>
            ) : null}
            {payment.maskedCard !== null ? (
              <div className="summary-line">
                <span>کارت</span>
                <strong>
                  <Ltr>{payment.maskedCard}</Ltr>
                </strong>
              </div>
            ) : null}
            {order !== null ? (
              <div className="summary-line">
                <span>وضعیت سفارش</span>
                <Badge tone={orderStatusView(order.status).tone}>{orderStatusView(order.status).label}</Badge>
              </div>
            ) : null}
          </div>
        ) : null}

        {settled ? (
          <p className="muted" style={{ fontSize: 12, marginBlockStart: 14 }}>
            پرداخت تأیید شد. آماده‌سازی سفارش پس از این مرحله انجام می‌شود و نتیجهٔ آن در صفحهٔ پیگیری سفارش نمایش داده می‌شود.
          </p>
        ) : null}

        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap", marginBlockStart: 20 }}>
          {undecided && !checking ? (
            <button type="button" className="btn btn-outline" onClick={() => void check()}>
              <RefreshCw size={16} aria-hidden="true" /> بررسی دوباره
            </button>
          ) : null}
          {failed && orderNumber !== null ? (
            <Link className="btn btn-primary" href={`/checkout/${orderNumber}`}>
              تلاش دوباره برای پرداخت
            </Link>
          ) : null}
          {orderNumber !== null ? (
            <Link className="btn btn-outline" href={`/orders/${orderNumber}`}>
              پیگیری سفارش <Ltr>{orderNumber}</Ltr>
            </Link>
          ) : (
            <Link className="btn btn-outline" href="/orders">
              سفارش‌های من
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}

export default function PaymentResultPage() {
  return (
    <Suspense
      fallback={
        <main className="page container" style={{ maxWidth: 560, textAlign: "center" }}>
          <p className="muted">در حال بررسی نتیجه پرداخت...</p>
        </main>
      }
    >
      <ResultContent />
    </Suspense>
  );
}
