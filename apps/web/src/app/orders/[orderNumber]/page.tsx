"use client";
import { use } from "react";
import { Badge, Ltr, Timeline } from "@barat/ui";
import type { TimelineStep } from "@barat/ui";
import { orderStatusView } from "@/lib/status";

export default function OrderDetailPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = use(params);
  const status = "FULFILLMENT_PENDING" as const;
  const view = orderStatusView(status);

  const steps: TimelineStep[] = [
    { id: "created", title: "ثبت سفارش", status: "done", timestamp: "۱۴۰۵/۰۶/۰۸ ۱۰:۱۲" },
    { id: "paid", title: "پرداخت تأیید شد", status: "done", timestamp: "۱۴۰۵/۰۶/۰۸ ۱۰:۱۴" },
    { id: "fulfilling", title: "در حال آماده‌سازی", description: "در انتظار تأمین‌کننده — نیازی به ثبت سفارش مجدد نیست", status: "current" },
    { id: "fulfilled", title: "تحویل نهایی", status: "pending" },
  ];

  return (
    <main className="page container" style={{ maxWidth: 720 }}>
      <div className="eyebrow">جزئیات سفارش</div>
      <h1 className="h2"><Ltr>{orderNumber}</Ltr></h1>
      <Badge tone={view.tone} style={{ marginBottom: 20 }}>{view.label}</Badge>

      <div className="card pad">
        <h3 style={{ marginTop: 0 }}>وضعیت سفارش</h3>
        <Timeline steps={steps} />
      </div>

      <div className="card pad" style={{ marginTop: 16 }}>
        <div className="summary-line"><span>محصول</span><strong>گیفت‌کارت اپل ۲۵ دلاری</strong></div>
        <div className="summary-line"><span>مبلغ پرداختی</span><strong><Ltr>۲٬۹۲۰٬۰۰۰ تومان</Ltr></strong></div>
        <div className="summary-line"><span>روش تحویل</span><strong>ایمیل مستقیم تأمین‌کننده</strong></div>
      </div>
    </main>
  );
}
