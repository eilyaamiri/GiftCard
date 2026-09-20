"use client";
import { useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@barat/ui";
import { paymentDeadline } from "../purchase";

export interface PaymentDeadlineProps {
  readonly createdAt: string;
  /** Computed on the server so the first client render matches the markup. */
  readonly secondsLeft: number;
}

/**
 * How long the customer has left to pay before the order closes itself.
 *
 * The countdown is a warning, not the rule — the API cancels the order on its
 * own schedule whether or not this page is open. Reaching zero therefore only
 * re-reads the order; whatever the server says by then is what gets rendered.
 */
export function PaymentDeadline({ createdAt, secondsLeft }: PaymentDeadlineProps) {
  const router = useRouter();
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (pending.current !== null) clearTimeout(pending.current);
  }, []);

  /* The sweep runs once a minute, so the order is usually still payable for a
   * few seconds after zero. Re-reading a moment later avoids showing the
   * customer an unchanged page and making the countdown look wrong. */
  const expire = useCallback(() => {
    pending.current = setTimeout(() => router.refresh(), 5_000);
  }, [router]);

  if (secondsLeft <= 0) {
    return <p className="payment-deadline">مهلت پرداخت این سفارش به پایان رسیده است.</p>;
  }

  return (
    <p className="payment-deadline">
      <span>مهلت پرداخت این سفارش</span>
      <CountdownTimer
        expiresAt={paymentDeadline(createdAt)}
        initialSeconds={secondsLeft}
        onExpire={expire}
        warnAtSeconds={120}
      />
    </p>
  );
}
