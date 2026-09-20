"use client";
import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { cancelOrder, purchaseError } from "../purchase";

/**
 * Lets the customer close an order they have decided not to pay for.
 *
 * Two clicks, not one: the first turns the link into an explicit question, the
 * second sends it. Cancelling is terminal — the price is not held and the order
 * cannot be resumed — so it should not be reachable by a stray tap next to the
 * payment button.
 *
 * Whether the order may actually be cancelled is decided server-side. This
 * component sends the request and shows whatever the API says; it never
 * concludes on its own that an order is closed.
 */
export function CancelOrder({ orderNumber }: { readonly orderNumber: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cancel = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await cancelOrder(orderNumber);
      /* The page is a server component reading the order, so refreshing it is
       * what shows the cancelled state — this component does not render it. */
      router.refresh();
    } catch (cause) {
      setError(purchaseError(cause).message);
      setBusy(false);
      setConfirming(false);
    }
  }, [busy, orderNumber, router]);

  return (
    <>
      {error !== null ? (
        <div className="alert warn" style={{ marginBlockStart: 14 }} role="alert">
          {error}
        </div>
      ) : null}

      {confirming ? (
        <div className="cancel-order-confirm">
          <p className="muted" style={{ fontSize: 13, marginBlockEnd: 10 }}>
            با لغو سفارش، این قیمت نگه داشته نمی‌شود و برای خرید دوباره باید پیش‌فاکتور جدید بگیرید.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-danger" onClick={() => void cancel()} disabled={busy}>
              {busy ? "در حال لغو..." : "بله، سفارش را لغو کن"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={busy}>
              پشیمان شدم
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-ghost cancel-order-start" onClick={() => setConfirming(true)}>
          <X size={16} aria-hidden="true" /> لغو سفارش
        </button>
      )}
    </>
  );
}
