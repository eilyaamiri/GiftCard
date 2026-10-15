"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Badge, Ltr } from "@barat/ui";
import type { OrderDetailDto, PaymentDto } from "@barat/contracts";
import { CheckCircle2, HelpCircle, Loader2, RefreshCw, XCircle } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";
import {
  clearPendingPayment,
  recallPendingPayment,
  tomanFromIrr,
  verifyPayment,
  type PendingPayment,
} from "@/app/checkout/purchase";
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
  const paramPaymentId = params.get("payment");
  const paramOrderNumber = params.get("order");

  const [payment, setPayment] = useState<PaymentDto | null>(null);
  const [order, setOrder] = useState<OrderDetailDto | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [recalled, setRecalled] = useState<PendingPayment | null>(null);
  const [recallDone, setRecallDone] = useState(false);
  const checkedKey = useRef<string | null>(null);

  /* A gateway can return the customer with our query string stripped. The ids
   * this browser stored on its way out are then the only way to know which
   * payment to verify and which order to offer a way back to. Read after mount
   * because sessionStorage does not exist while the page is server-rendered. */
  useEffect(() => {
    if (paramPaymentId === null && paramOrderNumber === null) {
      setRecalled(recallPendingPayment());
    }
    setRecallDone(true);
  }, [paramPaymentId, paramOrderNumber]);

  const paymentId = paramPaymentId ?? recalled?.paymentId ?? null;
  const orderNumber = paramOrderNumber ?? recalled?.orderNumber ?? null;

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
    /* Wait for the recall attempt: firing before it resolves would verify
     * nothing and then settle the screen as if the answer had come back. */
    if (!recallDone) return;
    const key = `${paymentId ?? ""}|${orderNumber ?? ""}`;
    if (checkedKey.current === key) return;
    checkedKey.current = key;
    if (paymentId === null && orderNumber === null) {
      /* Nothing identifies the payment, so there is nothing to ask about. */
      setChecking(false);
      return;
    }
    void check();
  }, [check, recallDone, paymentId, orderNumber]);

  const settled = payment !== null && payment.status === "PAID";
  const failed = payment !== null && (payment.status === "FAILED" || payment.status === "CANCELLED");
  const undecided = !settled && !failed;

  /* The stored ids exist to survive the trip through the gateway. Once the
   * outcome is settled they are stale, and a later visit to this page should
   * not resurrect a payment the customer already saw resolved. An undecided
   * payment keeps them, because that is exactly the case this page is asked
   * about again. */
  useEffect(() => {
    if (settled || failed) clearPendingPayment();
  }, [settled, failed]);

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="card pad" style={{ padding: 32, textAlign: "center" }}>
        {checking && payment === null ? (
          <>
            <Loader2 className="animate-spin" size={44} style={{ color: "var(--text-link)", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" />
            <h1 className="h2">در حال بررسی نتیجه پرداخت</h1>
            <p className="muted">لطفاً این صفحه را نبندید.</p>
          </>
        ) : (
          <>
            {settled ? <CheckCircle2 size={44} style={{ color: "var(--green)", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" /> : failed ? <XCircle size={44} style={{ color: "var(--danger)", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" /> : <HelpCircle size={44} style={{ color: "var(--amber)", marginInline: "auto", marginBlockEnd: 18 }} aria-hidden="true" />}
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
          {/* Offered only when there is a payment to ask about. Without one the
            * button would call an endpoint with nothing and leave the screen
            * exactly as it was, which reads as a broken page. */}
          {undecided && !checking && paymentId !== null ? (
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
