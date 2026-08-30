"use client";
import { use, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CountdownTimer, Ltr } from "@barat/ui";
import { RefreshCw } from "lucide-react";

/**
 * POC note: this page is wired to render a `QuoteSnapshot` shape identical to
 * `@barat/contracts` `GetQuoteResponse`. Until quotes.ts pricing endpoints are
 * live, a deterministic demo snapshot is derived from the route id so the
 * countdown / expiry / re-quote flows are fully exercised end to end.
 */
function buildDemoQuote(id: string) {
  const now = Date.now();
  return {
    quoteNumber: `Q-${id.slice(-8).toUpperCase()}`,
    expiresAt: new Date(now + 5 * 60 * 1000).toISOString(),
    lines: [
      { label: "ارزش گیفت‌کارت", amount: "۲٬۸۰۰٬۰۰۰ تومان" },
      { label: "کارمزد پرداخت", amount: "۴۵٬۰۰۰ تومان" },
      { label: "کارمزد خدمت", amount: "۷۵٬۰۰۰ تومان" },
    ],
    total: "۲٬۹۲۰٬۰۰۰ تومان",
  };
}

export default function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const quote = useMemo(() => buildDemoQuote(id), [id]);
  const [expired, setExpired] = useState(false);
  const [accepting, setAccepting] = useState(false);

  async function accept() {
    setAccepting(true);
    await new Promise((r) => setTimeout(r, 500));
    router.push(`/checkout/ORD-${id.slice(-8).toUpperCase()}` as never);
  }

  return (
    <main className="page container" style={{ maxWidth: 640 }}>
      <div className="eyebrow">پیش‌فاکتور</div>
      <h1 className="h2">بررسی قیمت</h1>
      <p className="muted">شماره پیش‌فاکتور <Ltr>{quote.quoteNumber}</Ltr></p>

      <div className="card pad" style={{ marginTop: 18 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span className="muted" style={{ fontSize: 13 }}>اعتبار قیمت</span>
          {expired ? (
            <span className="chip" style={{ background: "#FCE9E9", color: "#D94A4A", borderColor: "#D94A4A" }}>قیمت منقضی شد</span>
          ) : (
            <CountdownTimer expiresAt={quote.expiresAt} onExpire={() => setExpired(true)} />
          )}
        </div>

        {expired ? (
          <div className="alert warn" style={{ marginBottom: 16 }}>
            مهلت این قیمت به پایان رسید. برای دریافت نرخ روز، پیش‌فاکتور جدیدی بسازید.
          </div>
        ) : null}

        {quote.lines.map((line) => (
          <div className="summary-line" key={line.label}>
            <span>{line.label}</span>
            <strong><Ltr>{line.amount}</Ltr></strong>
          </div>
        ))}
        <div className="summary-total">
          <span>مبلغ قابل پرداخت</span>
          <Ltr>{quote.total}</Ltr>
        </div>

        {expired ? (
          <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 18 }} onClick={() => router.back()}>
            <RefreshCw size={16} /> دریافت قیمت جدید
          </button>
        ) : (
          <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 18 }} onClick={accept} disabled={accepting}>
            {accepting ? "در حال ثبت..." : "تأیید و ادامه پرداخت"}
          </button>
        )}
      </div>
    </main>
  );
}
