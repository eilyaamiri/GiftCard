"use client";
import { useCallback, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CountdownTimer } from "@barat/ui";
import type { QuoteSnapshot } from "@barat/contracts";
import { RefreshCw } from "lucide-react";
import { ApiClientError } from "@/lib/api";
import { peekCommerceSessionToken } from "@/lib/commerce-session";
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

/**
 * ACCEPTED counts as payable, not as over: acceptance is idempotent (the key is
 * derived from the quote id), so a customer who accepted, was sent to login and
 * came back resumes exactly where they were — the replay re-confirms the same
 * acceptance and ordering continues. Only the clock and a terminal status end it.
 */
function quoteOver(quote: QuoteSnapshot): boolean {
  return (quote.status !== "ACTIVE" && quote.status !== "ACCEPTED") || quote.remainingSeconds === 0;
}

export function QuoteActions({
  quote,
  isSignedIn,
  children,
}: {
  readonly quote: QuoteSnapshot;
  readonly isSignedIn: boolean;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(quoteOver(quote) ? "expired" : "live");
  const [error, setError] = useState<string | null>(null);

  const expire = useCallback(() => {
    setPhase((current) => (current === "live" ? "expired" : current));
  }, []);

  const loginHref = `/login?next=${encodeURIComponent(`/quote/${quote.id}`)}`;

  const submit = useCallback(async () => {
    /* Ordering needs a customer. Going to login BEFORE accepting keeps the quote
     * untouched while the customer is away, and `next` brings them straight back
     * here — not to the account panel — to finish the payment. */
    if (!isSignedIn) {
      router.push(loginHref);
      return;
    }
    setError(null);
    setPhase("submitting");
    try {
      /* The acknowledged amount is the snapshot's own total, so a stale tab or a
       * tampered field is rejected by the server instead of being priced. The
       * commerce-session token is this browser's claim on a quote made before
       * login — the row still has no customer id. */
      const commerceToken = peekCommerceSessionToken() ?? undefined;
      const accepted = await acceptQuote(quote, commerceToken);
      if (accepted.requoteRequired) {
        setPhase("expired");
        return;
      }
      const order = await createOrder(quote, commerceToken);
      router.push(`/checkout/${order.order.orderNumber}`);
    } catch (cause) {
      /* The session can expire between render and click; sign in and come back. */
      if (cause instanceof ApiClientError && cause.isUnauthenticated) {
        router.push(loginHref);
        return;
      }
      const failure = purchaseError(cause);
      setError(failure.message);
      setPhase(failure.requoteRequired ? "expired" : "live");
    }
  }, [quote, isSignedIn, loginHref, router]);

  const expired = phase === "expired";

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBlockEnd: 14, flexWrap: "wrap" }}>
        <span className="muted" style={{ fontSize: 13 }}>
          اعتبار قیمت
        </span>
        {expired ? (
          <span className="chip" style={{ background: "var(--danger-bg)", color: "var(--danger)", borderColor: "var(--danger-line)", cursor: "default" }}>
            مهلت قیمت تمام شد
          </span>
        ) : (
          <CountdownTimer expiresAt={quote.expiresAt} initialSeconds={quote.remainingSeconds} onExpire={expire} />
        )}
      </div>

      {expired ? (
        <div className="alert warn" style={{ marginBlockEnd: 16 }} role="status">
          مهلت این قیمت به پایان رسید و دیگر قابل پرداخت نیست. برای ادامه باید قیمت جدیدی با نرخ روز بگیرید و آن را تأیید کنید.
        </div>
      ) : null}

      {!expired && !isSignedIn ? (
        <div className="alert" style={{ marginBlockEnd: 16 }} role="status">
          برای پرداخت ابتدا وارد حساب خود می‌شوید و بلافاصله به همین پیش‌فاکتور برمی‌گردید.
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
        <Link className="btn btn-primary" style={{ width: "100%", marginBlockStart: 18 }} href={{ pathname: "/quote/new", query: requoteQuery(quote) }}>
          <RefreshCw size={16} aria-hidden="true" /> دریافت قیمت جدید
        </Link>
      ) : (
        <button type="button" className="btn btn-primary" style={{ width: "100%", marginBlockStart: 18 }} onClick={() => void submit()} disabled={phase === "submitting"}>
          {phase === "submitting" ? "در حال ثبت سفارش..." : isSignedIn ? "تأیید قیمت و ثبت سفارش" : "ورود و ادامه خرید"}
        </button>
      )}
    </>
  );
}
