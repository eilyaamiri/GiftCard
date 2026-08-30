import Link from "next/link";
import { notFound } from "next/navigation";
import { formatToman } from "@barat/ui";
import { findOrder, ORDER_STATUS_BADGE, ORDER_STATUS_LABEL } from "@/lib/mock-orders";

export const metadata = { title: "جزئیات سفارش | پنل ادمین برات پی" };

const TIMELINE = [
  { label: "سفارش ثبت شد", time: "۰۹:۵۸" },
  { label: "پرداخت تأیید شد", time: "۱۰:۰۰" },
  { label: "به اپراتور تخصیص یافت", time: "۱۰:۰۴" },
  { label: "خرید از تأمین‌کننده ثبت شد", time: "۱۰:۱۸" },
  { label: "در انتظار تکمیل چک‌لیست", time: "اکنون" },
];

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = findOrder(id);
  if (!order) notFound();

  return (
    <div>
      <p className="breadcrumb">
        <Link href="/orders">سفارش‌ها</Link>
        <span>/</span>
        <span className="order-id">{order.number}</span>
      </p>

      <div className="page-heading">
        <div>
          <p className="eyebrow">جزئیات سفارش</p>
          <h1 className="order-id">{order.number}</h1>
        </div>
        <span className={`badge ${ORDER_STATUS_BADGE[order.status]}`}>{ORDER_STATUS_LABEL[order.status]}</span>
      </div>

      <div className="stat-strip">
        <div className="card stat-tile"><span>مشتری</span><strong>{order.customer}</strong></div>
        <div className="card stat-tile"><span>محصول</span><strong>{order.sku}</strong></div>
        <div className="card stat-tile"><span>مبلغ کل</span><strong>{formatToman(order.totalIrr)}</strong></div>
        <div className="card stat-tile"><span>زمان ثبت</span><strong>{order.createdAt}</strong></div>
      </div>

      <div className="two-col">
        <div className="card panel">
          <div className="panel-heading">
            <h2 className="panel-title">جدول زمانی سفارش</h2>
          </div>
          <div className="timeline">
            {TIMELINE.map((step) => (
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
            <h2 className="panel-title">اطلاعات مرتبط</h2>
          </div>
          <div className="kv-list">
            <div className="kv-row"><span>شناسهٔ استعلام</span><span className="bp-ltr">QT-88213</span></div>
            <div className="kv-row"><span>شناسهٔ پرداخت</span><span className="bp-ltr">PAY-55021</span></div>
            <div className="kv-row"><span>تسک اپراتور</span><span className="bp-ltr">WI-77410</span></div>
            <div className="kv-row"><span>تأمین‌کننده</span><span>Tillo</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
