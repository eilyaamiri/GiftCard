"use client";
import { use, useState } from "react";
import { Ltr } from "@barat/ui";
import { Lock } from "lucide-react";

export default function CheckoutPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = use(params);
  const [starting, setStarting] = useState(false);

  async function startPayment() {
    setStarting(true);
    // POC: would call POST /api/payments with { orderId, idempotencyKey } and
    // redirect the browser to the provider-hosted `redirectUrl`.
    await new Promise((r) => setTimeout(r, 500));
    window.location.href = `/payment/result?orderNumber=${encodeURIComponent(orderNumber)}`;
  }

  return (
    <main className="page container" style={{ maxWidth: 560 }}>
      <div className="eyebrow">تسویه حساب</div>
      <h1 className="h2">تأیید نهایی سفارش</h1>
      <p className="muted">شماره سفارش <Ltr>{orderNumber}</Ltr></p>

      <div className="card pad" style={{ marginTop: 18 }}>
        <div className="summary-line"><span>محصول</span><strong>گیفت‌کارت</strong></div>
        <div className="summary-line"><span>مبلغ قابل پرداخت</span><strong><Ltr>۲٬۹۲۰٬۰۰۰ تومان</Ltr></strong></div>
        <div className="alert" style={{ marginTop: 14 }}>
          پس از پرداخت موفق، سفارش وارد صف آماده‌سازی می‌شود و می‌توانید وضعیت آن را از صفحه پیگیری سفارش دنبال کنید.
        </div>
        <button type="button" className="btn btn-primary" style={{ width: "100%", marginTop: 18 }} onClick={startPayment} disabled={starting}>
          <Lock size={16} /> {starting ? "در حال انتقال به درگاه..." : "پرداخت امن"}
        </button>
      </div>
    </main>
  );
}
