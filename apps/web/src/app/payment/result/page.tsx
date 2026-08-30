"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Ltr } from "@barat/ui";
import { CheckCircle2, Loader2, XCircle, HelpCircle } from "lucide-react";
import { api, ApiClientError } from "@/lib/api";

type Outcome = "PENDING" | "PAID" | "FAILED" | "UNKNOWN";

/**
 * AGENTS.md rule 8: the query string (`Status`, `Authority`) is untrusted
 * gateway input used ONLY to locate the payment. The actual outcome always
 * comes from a server-verified call — never from these params directly.
 */
function ResultContent() {
  const params = useSearchParams();
  const [outcome, setOutcome] = useState<Outcome>("PENDING");
  const [message, setMessage] = useState("در حال بررسی نتیجه پرداخت...");

  useEffect(() => {
    const orderNumber = params.get("orderNumber");
    const providerAuthority = params.get("Authority") ?? params.get("authority");
    let cancelled = false;

    async function verify() {
      try {
        const stableIdentifier = orderNumber ?? providerAuthority ?? "unknown";
        const idempotencyKey = `verify-${stableIdentifier}`.replace(/[^A-Za-z0-9_-]/gu, "-").padEnd(16, "0").slice(0, 128);
        const result = await api.post<{ outcome: "PAID" | "FAILED" | "CANCELLED" | "ALREADY_VERIFIED" | "UNKNOWN"; messageFa: string }>("/api/payments/verify", {
          providerAuthority: providerAuthority ?? undefined,
          idempotencyKey,
        });
        if (!cancelled) {
          setOutcome(result.outcome === "PAID" ? "PAID" : result.outcome === "FAILED" || result.outcome === "CANCELLED" ? "FAILED" : "UNKNOWN");
          setMessage(result.messageFa);
        }
      } catch (error) {
        if (cancelled) return;
        // Backend not reachable yet in this POC slice — never assume success.
        setOutcome("UNKNOWN");
        setMessage(error instanceof ApiClientError ? error.message : "در حال بررسی نتیجه با پشتیبانی هستیم.");
      }
    }

    void verify();
    return () => {
      cancelled = true;
    };
  }, [params]);

  const orderNumber = params.get("orderNumber");

  return (
    <main className="page container" style={{ maxWidth: 520, textAlign: "center" }}>
      <div className="card pad" style={{ padding: 40 }}>
        {outcome === "PENDING" ? (
          <>
            <Loader2 className="animate-spin" size={44} style={{ color: "var(--teal)", margin: "0 auto 18px" }} />
            <h1 className="h2">در حال بررسی نتیجه پرداخت...</h1>
            <p className="muted">لطفاً این صفحه را نبندید.</p>
          </>
        ) : outcome === "PAID" ? (
          <>
            <CheckCircle2 size={44} style={{ color: "var(--green)", margin: "0 auto 18px" }} />
            <h1 className="h2">پرداخت تأیید شد، سفارش در حال آماده‌سازی است</h1>
            <p className="muted">{message || "سفارش شما در حال آماده‌سازی است."}</p>
          </>
        ) : outcome === "FAILED" ? (
          <>
            <XCircle size={44} style={{ color: "var(--status-red, #D94A4A)", margin: "0 auto 18px" }} />
            <h1 className="h2">پرداخت ناموفق بود</h1>
            <p className="muted">{message || "مبلغی از حساب شما کسر نشده است. می‌توانید دوباره تلاش کنید."}</p>
          </>
        ) : (
          <>
            <HelpCircle size={44} style={{ color: "var(--amber)", margin: "0 auto 18px" }} />
            <h1 className="h2">در حال بررسی</h1>
            <p className="muted">{message || "نتیجه پرداخت هنوز قطعی نشده؛ به‌محض مشخص شدن به شما اطلاع می‌دهیم."}</p>
          </>
        )}
        {orderNumber ? (
          <Link className="btn btn-outline" style={{ marginTop: 20 }} href={`/orders/${encodeURIComponent(orderNumber)}`}>
            پیگیری سفارش <Ltr>{orderNumber}</Ltr>
          </Link>
        ) : (
          <Link className="btn btn-outline" style={{ marginTop: 20 }} href="/orders">
            مشاهده سفارش‌های من
          </Link>
        )}
      </div>
    </main>
  );
}

export default function PaymentResultPage() {
  return (
    <Suspense fallback={<main className="page container" style={{ textAlign: "center" }}>در حال بررسی نتیجه پرداخت...</main>}>
      <ResultContent />
    </Suspense>
  );
}
