"use client";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@barat/ui";
import type { QuoteSnapshot } from "@barat/contracts";
import { RefreshCw } from "lucide-react";
import { acceptQuote, createOrder, purchaseError } from "@/app/checkout/purchase";

/**
 * Where to go for a fresh price. Built from the snapshot rather than from the
 * URL that produced it, so a re-quote always asks for the same item at today's
 * rate — and the customer sees and accepts that new price before paying.
 */
export function requoteQuery(quote: QuoteSnapshot): Record<string, string> {
  return {
    ...(quote.skuId === null ? {} : { sku: quote.skuId }),
    ...(quote.serviceId === null ? {} : { service: quote.serviceId }),
    quantity: String(quote.quantity),
    currency: quote.currency,
  };
}

type Phase = "live" | "expired" | "submitting";

export function QuoteActions({ quote, children }: { readonly quote: QuoteSnapshot; readonly children: ReactNode }) {
  const router = useRouter();
  const alreadyOver = quote.status !== "ACTIVE" || quote.remainingSeconds === 0;
  const [phase, setPhase] = useState<Phase>(alreadyOver ? "expired" : "live");
  const [error, setError] = useState<string | null>(null);

  /**
   * The countdown is anchored to `remainingSeconds` measured at mount rather
   * than to `expiresAt` read against the browser clock: a device whose clock is
   * minutes fast would otherwise let the customer keep a lapsed price on screen.
   * Anchoring at mount can only ever expire slightly early, which is the safe
   * direction — the server refuses a late acceptance regardless.
   */
  const deadline = useMemo(() => new Date(Date.now() + quote.remainingSeconds * 1000).toISOString(), [quote.remainingSeconds]);

  const expire = useCallback(() => {
    setPhase((current) => (current === "live" ? "expired" : current));
  }, []);

  const submit = useCallback(async () => {
    setError(null);
    setPhase("submitting");
    try {
      /* The acknowledged amount is the snapshot's own total, so a stale tab or a
       * tampered field is rejected by the server instead of being priced. */
      const accepted = await acceptQuote(quote);
      if (accepted.requoteRequired) {
        setPhase("expired");
        return;
      }
      const order = await createOrder(quote);
      router.push(`/checkout/${order.order.orderNumber}`);
    } catch (cause) {
      const failure = purchaseError(cause);
      setError(failure.message);
      setPhase(failure.requoteRequired ? "expired" : "live");
    }
  }, [quote, router]);

  const expired = phase === "expired";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBlockEnd: 14, flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 13 }}>
          اعتبار قیمت
        </span>
        {expired ? (
          <span className="chip" style={{ background: "#FCE9E9", color: "#D94A4A", borderColor: "#D94A4A", cursor: "default" }}>
            مهلت قیمت تمام شد
          </span>
        ) : (
          <CountdownTimer expiresAt={deadline} onExpire={expire} />
        )}
      </div>

      {expired ? (
        <div className="alert warn" style={{ marginBlockEnd: 16 }} role="status">
          مهلت این قیمت به پایان رسید و دیگر قابل پرداخت نیست. برای ادامه باید قیمت جدیدی با نرخ روز بگیرید و آن را تأیید کنید.
        </div>
      ) : null}

      {error !== null ? (
        <div className="alert warn" style={{ marginBlockEnd: 16 }} role="alert">
          {error}
        </div>
      ) : null}

      <div aria-hidden={expired ? "true" : undefined} style={expired ? { opacity: 0.55 } : undefined}>
        {children}
      </div>

      {expired ? (
        <Link className="btn btn-primary" style={{ width: "100%", marginBlockStart: 18, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8 }} href={{ pathname: "/quote/new", query: requoteQuery(quote) }}>
          <RefreshCw size={16} aria-hidden="true" /> دریافت قیمت جدید
        </Link>
      ) : (
        <button type="button" className="btn btn-primary" style={{ width: "100%", marginBlockStart: 18 }} onClick={() => void submit()} disabled={phase === "submitting"}>
          {phase === "submitting" ? "در حال ثبت سفارش..." : "تأیید قیمت و ثبت سفارش"}
        </button>
      )}
    </>
  );
}
