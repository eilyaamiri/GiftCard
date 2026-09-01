"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { createPayment, gatewayDestination, paymentAttempt, purchaseError, resetPaymentAttempt } from "../purchase";

/**
 * Opens a payment session and hands the browser over to wherever the API says
 * to go.
 *
 * The button knows nothing about which gateway is configured. When the API
 * returns a hosted page we navigate there; when it returns no navigable page
 * (see `gatewayDestination`) the flow continues to the result screen, which
 * asks the server for the verified outcome. Either way the outcome is decided
 * server-side — this component never concludes anything about the money.
 */
export function StartPayment({
  orderId,
  orderNumber,
  label = "پرداخت امن",
  busyLabel = "در حال انتقال به درگاه...",
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly label?: string;
  readonly busyLabel?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createPayment(orderId, paymentAttempt(orderId));
      const destination = gatewayDestination(result.redirectUrl);
      const resultPath = `/payment/result?order=${encodeURIComponent(orderNumber)}&payment=${encodeURIComponent(result.payment.id)}`;
      if (destination !== null) {
        window.location.assign(destination);
        return;
      }
      router.push(resultPath);
    } catch (cause) {
      /* A failed attempt must not be replayed under the same key, or the API
       * would keep returning the same dead payment session. */
      resetPaymentAttempt(orderId);
      setError(purchaseError(cause).message);
      setBusy(false);
    }
  }, [busy, orderId, orderNumber, router]);

  return (
    <>
      {error !== null ? (
        <div className="alert warn" style={{ marginBlockStart: 14 }} role="alert">
          {error}
        </div>
      ) : null}
      {/* The top margin lives in CSS, not here: this button is stacked under an
        * alert on the checkout page but sits in a flex row on the order page,
        * where a margin would knock it out of line with its neighbours. */}
      <button type="button" className="btn btn-primary payment-start" onClick={() => void start()} disabled={busy}>
        <Lock size={16} aria-hidden="true" /> {busy ? busyLabel : label}
      </button>
    </>
  );
}
