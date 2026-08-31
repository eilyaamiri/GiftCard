import Link from "next/link";
import { formatToman, toPersianDigits } from "@barat/ui";
import { CheckCircle2, FileBarChart, ShoppingBag, Wallet, XCircle } from "lucide-react";
import { loadDashboardData } from "../dashboard/dashboard-data";
import { SlaPerformanceReport } from "@/components/sla-performance-report";
import { QUEUE_VIEW_ROLES, REPORT_ROLES, type StaffUser } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { workItems, type WorkItemSummary } from "@/app/(operator)/_lib/work-items";

export const metadata = { title: "گزارش‌ها | پنل ادمین برات پی" };

/**
 * This is deliberately a server-rendered report. It consumes the same live
 * order/FX sources as the dashboard and does not invent payment, margin,
 * customer-cohort, KYC, support, or chargeback figures that the API cannot
 * currently provide.
 */
export default async function ReportsPage() {
  const staff = await requireRole(REPORT_ROLES);
  const data = await loadDashboardData();
  const operationalItems = await loadOperationalItems(staff);

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">گزارش‌های واقعی پلتفرم</p>
          <h1>گزارش‌ها و تحلیل عملکرد</h1>
        </div>
        <div className="report-source">
          <FileBarChart size={16} aria-hidden="true" />
          <span>منبع: سفارش‌ها و Work Itemهای ثبت‌شده در سرور</span>
        </div>
      </div>

      <div className="toolbar">
        <div>
          <strong className="report-filter-title">بازهٔ فروش</strong>
          <span className="muted report-filter-note">۷ روز تقویمی اخیر، شامل امروز</span>
        </div>
        <Link href="/dashboard" className="secondary-btn report-link">مشاهدهٔ داشبورد</Link>
      </div>

      <section aria-labelledby="sales-report-title">
        <div className="section-label report-section-heading">
          <div>
            <h2 id="sales-report-title">فروش و GMV</h2>
            <span>جمع مبالغ فقط از سفارش‌هایی که زمان پرداخت واقعی دارند</span>
          </div>
        </div>
        <div className="kpi-grid">
          <ReportKpi icon={<ShoppingBag size={16} />} label="کل سفارش‌ها" value={count(data.totalOrders)} detail={`${count(data.ordersToday)} سفارش امروز`} />
          <ReportKpi icon={<Wallet size={16} />} label="GMV پرداخت‌شده" value={formatToman(data.collectedGmvIrr)} detail="مجموع دقیق ریالی سفارش‌های پرداخت‌شده" />
          <ReportKpi icon={<CheckCircle2 size={16} />} label="تحویل‌شده" value={count(data.fulfilledOrders)} detail="سفارش‌های با وضعیت تحویل‌شده" accent="#18a66a" tint="#e7f7f0" />
          <ReportKpi icon={<XCircle size={16} />} label="ناموفق" value={count(data.failedOrders)} detail="سفارش‌های دارای وضعیت ناموفق" accent="#d94a4a" tint="#fdeceb" />
        </div>
      </section>

      <div className="dashboard-grid report-grid">
        <section className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">حجم سفارش در ۷ روز اخیر</h2>
              <p className="panel-caption">تعداد سفارش‌های ثبت‌شده به تفکیک روز</p>
            </div>
          </div>
          <div className="volume-chart">
            {data.volume7d.map((day) => (
              <div key={day.dateKey} className="bar-column">
                <span className="bar-value">{count(day.orders)}</span>
                <div className="bar" role="img" aria-label={`${day.label}: ${count(day.orders)} سفارش`} style={{ height: `${(day.orders / Math.max(1, ...data.volume7d.map((entry) => entry.orders))) * 100}%` }} />
                <span className="bar-label">{day.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">تفکیک وضعیت سفارش</h2>
              <p className="panel-caption">کل سفارش‌های موجود در API</p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>وضعیت</th><th>تعداد</th></tr></thead>
              <tbody>{Object.entries(data.statusCounts).map(([status, value]) => <tr key={status}><td>{ORDER_STATUS_LABEL[status] ?? status}</td><td>{count(value ?? 0)}</td></tr>)}</tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="report-section">
        <div className="panel-heading card panel report-heading-panel">
          <div>
            <h2 className="panel-title">عملیات، بهره‌وری و SLA</h2>
            <p className="panel-caption">بر پایهٔ Work Itemهای واقعی؛ برای جزئیات کامل به گزارش SLA بروید.</p>
          </div>
          <Link href="/sla" className="order-id">گزارش SLA ←</Link>
        </div>
        {operationalItems === null ? (
          <div className="card panel"><p className="empty-hint">دادهٔ صف عملیات برای نقش فعلی در دسترس نیست. این بخش به مجوز مشاهدهٔ صف نیاز دارد.</p></div>
        ) : operationalItems.length === 0 ? (
          <div className="card panel"><p className="empty-hint">هنوز Work Item عملیاتی برای گزارش ثبت نشده است.</p></div>
        ) : (
          <SlaPerformanceReport items={operationalItems} embedded />
        )}
      </section>

      <section className="card panel report-section report-limitations">
        <div className="panel-heading">
          <div>
            <h2 className="panel-title">گزارش‌های در انتظار اتصال داده</h2>
            <p className="panel-caption">این موارد تا زمان ارائهٔ منبع واقعی در API عددسازی نمی‌شوند.</p>
          </div>
        </div>
        <div className="report-capability-grid">
          <Capability label="بازگشت وجه و Chargeback" reason="دفترکل پرداخت و endpoint گزارش بازگشت وجه هنوز ارائه نشده است." />
          <Capability label="کوهورت مشتری و CLV" reason="endpoint تجمیع مشتری و تاریخچهٔ کامل خرید در این API موجود نیست." />
          <Capability label="KYC و ریسک" reason="دادهٔ KYC قابل گزارش‌گیری در API فعلی در دسترس نیست." />
          <Capability label="پشتیبانی و CSAT" reason="تیکت و شاخص CSAT قابل اندازه‌گیری در API فعلی موجود نیست." />
        </div>
      </section>
    </div>
  );
}

async function loadOperationalItems(staff: StaffUser): Promise<readonly WorkItemSummary[] | null> {
  if (!QUEUE_VIEW_ROLES.includes(staff.role as (typeof QUEUE_VIEW_ROLES)[number])) return null;
  try {
    return await workItems.list({ take: 200 });
  } catch {
    return null;
  }
}

const ORDER_STATUS_LABEL: Record<string, string> = {
  DRAFT: "پیش‌نویس", AWAITING_PAYMENT: "در انتظار پرداخت", PAYMENT_PENDING: "پرداخت در جریان",
  PAID: "پرداخت‌شده", FULFILLMENT_PENDING: "در صف تحویل", FULFILLING: "در حال تحویل",
  FULFILLED: "تحویل‌شده", FAILED: "ناموفق", REVIEW_REQUIRED: "نیازمند بررسی",
  REFUND_PENDING: "در انتظار بازگشت وجه", REFUNDED: "بازگشت‌وجه‌شده", CANCELLED: "لغوشده",
};

function count(value: number): string { return toPersianDigits(value.toLocaleString("en-US")); }

function ReportKpi({ icon, label, value, detail, accent = "#21b4b0", tint = "#dff7f5" }: { icon: React.ReactNode; label: string; value: string; detail: string; accent?: string; tint?: string }) {
  return <div className="card kpi" style={{ ["--accent" as string]: accent, ["--tint" as string]: tint }}><div className="kpi-top"><span>{label}</span><span className="kpi-icon">{icon}</span></div><p className="kpi-value">{value}</p><p className="kpi-trend trend-neutral">{detail}</p></div>;
}

function Capability({ label, reason }: { label: string; reason: string }) {
  return <div className="report-capability"><strong>{label}</strong><span>{reason}</span></div>;
}
