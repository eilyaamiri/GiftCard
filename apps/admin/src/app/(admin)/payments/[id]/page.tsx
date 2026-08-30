import Link from "next/link";
import { notFound } from "next/navigation";
import { findPayment, formatExactAmount, PAYMENT_STATUS_BADGE, PAYMENT_STATUS_LABEL } from "@/lib/mock-payments";

export const metadata = { title: "جزئیات پرداخت | پنل ادمین برات پی" };

const HISTORY = [
  { label: "پرداخت آغاز شد (INITIATED)", time: "۰۹:۵۸" },
  { label: "کاربر به درگاه هدایت شد", time: "۰۹:۵۸" },
  { label: "بازگشت از درگاه دریافت شد (Callback)", time: "۱۰:۰۰" },
  { label: "صحت‌سنجی سمت سرور موفق بود (Verify)", time: "۱۰:۰۰" },
];

export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payment = findPayment(id);
  if (!payment) notFound();

  return (
    <div>
      <p className="breadcrumb">
        <Link href="/payments">پرداخت‌ها</Link>
        <span>/</span>
        <span className="bp-ltr">{payment.authority.slice(0, 14)}…</span>
      </p>

      <div className="page-heading">
        <div>
          <p className="eyebrow">جزئیات پرداخت</p>
          <h1>سفارش {payment.orderNumber}</h1>
        </div>
        <span className={`badge ${PAYMENT_STATUS_BADGE[payment.status]}`}>{PAYMENT_STATUS_LABEL[payment.status]}</span>
      </div>

      <div className="two-col">
        <div className="card panel">
          <div className="panel-heading">
            <h2 className="panel-title">تاریخچهٔ وضعیت</h2>
          </div>
          <div className="timeline">
            {HISTORY.map((step) => (
              <div className="timeline-row" key={step.label}>
                <span className="timeline-dot" />
                <div className="timeline-copy">
                  <strong>{step.label}</strong>
                  <span className="bp-ltr">{step.time}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card panel">
          <div className="panel-heading">
            <h2 className="panel-title">اطلاعات درگاه</h2>
          </div>
          <div className="kv-list">
            <div className="kv-row"><span>Authority</span><span className="bp-ltr" style={{ fontSize: 10 }}>{payment.authority}</span></div>
            <div className="kv-row"><span>RefId</span><span className="bp-ltr">{payment.refId ?? "—"}</span></div>
            <div className="kv-row"><span>مبلغ درگاه</span><span className="bp-ltr">{formatExactAmount(payment.providerAmount)} {payment.providerAmountUnit}</span></div>
            <div className="kv-row"><span>کارت (masked)</span><span className="bp-ltr">{payment.maskedCard ?? "—"}</span></div>
          </div>
          <p className="warning" style={{ marginTop: 16 }}>هیچ توکن پرداخت، رمز API یا مقدار OTP در این صفحه یا در لاگ‌های سرور نمایش داده نمی‌شود.</p>
        </div>
      </div>
    </div>
  );
}
