import Link from "next/link";
import type { OrderStatus, OrderSummaryDto } from "@barat/contracts";
import { formatToman, toPersianDigits } from "@barat/ui";
import { CheckCircle2, FileBarChart, ShoppingBag, Wallet, XCircle } from "lucide-react";
import { fetchAllOrders } from "../dashboard/dashboard-data";
import { SlaPerformanceReport } from "@/components/sla-performance-report";
import { QUEUE_VIEW_ROLES, REPORT_ROLES, type StaffUser } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  QUEUE_KEY_LABEL,
  WORK_ITEM_TYPE_LABEL,
  workItems,
  type WorkItemSummary,
} from "@/app/(operator)/_lib/work-items";
import {
  filterReportOrders,
  filterReportWorkItems,
  readReportFilters,
  type ReportFilters,
} from "@/lib/report-filters";
import { ORDER_STATUS_LABEL } from "@/lib/order-format";

export const metadata = { title: "گزارش‌ها | پنل ادمین برات پی" };

/**
 * Server-rendered reporting over live records. Unsupported domains remain
 * explicit empty capabilities; no prototype number is ever copied as data.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const staff = await requireRole(REPORT_ROLES);
  const filters = readReportFilters(await searchParams);
  const [allOrders, operationalItems] = await Promise.all([
    fetchAllOrders(),
    loadOperationalItems(staff),
  ]);
  const orders = filterReportOrders(allOrders, filters);
  const filteredItems = operationalItems === null
    ? null
    : filterReportWorkItems(operationalItems, filters);
  const sales = calculateSales(orders, filters);

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

      <ReportFilterForm filters={filters} />

      <section aria-labelledby="sales-report-title">
        <div className="section-label report-section-heading">
          <div>
            <h2 id="sales-report-title">فروش و GMV</h2>
            <span>مبالغ فقط از سفارش‌هایی جمع می‌شوند که زمان پرداخت واقعی دارند</span>
          </div>
          <span>{dateRangeLabel(filters)}</span>
        </div>
        <div className="kpi-grid">
          <ReportKpi icon={<ShoppingBag size={16} />} label="سفارش‌های بازه" value={count(orders.length)} detail={`${count(sales.paidOrders)} سفارش پرداخت‌شده`} />
          <ReportKpi icon={<Wallet size={16} />} label="GMV پرداخت‌شده" value={formatToman(sales.gmvIrr)} detail="مجموع دقیق سفارش‌های پرداخت‌شده" />
          <ReportKpi icon={<CheckCircle2 size={16} />} label="تحویل‌شده" value={count(sales.fulfilled)} detail={percent(sales.fulfilled, orders.length)} accent="#18a66a" tint="#e7f7f0" />
          <ReportKpi icon={<XCircle size={16} />} label="ناموفق" value={count(sales.failed)} detail={percent(sales.failed, orders.length)} accent="#d94a4a" tint="#fdeceb" />
        </div>
      </section>

      <div className="dashboard-grid report-grid">
        <section className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">حجم سفارش روزانه</h2>
              <p className="panel-caption">{sales.chartWasCapped ? "۳۱ روز آخر بازه نمایش داده می‌شود؛ KPIها کل بازه را پوشش می‌دهند." : "تمام روزهای بازهٔ انتخابی"}</p>
            </div>
          </div>
          <div className="volume-chart">
            {sales.daily.map((day) => (
              <div key={day.date} className="bar-column">
                <span className="bar-value">{count(day.orders)}</span>
                <div className="bar" role="img" aria-label={`${day.label}: ${count(day.orders)} سفارش`} style={{ height: `${(day.orders / sales.maxDaily) * 100}%` }} />
                <span className="bar-label">{day.label}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">تفکیک وضعیت سفارش</h2>
              <p className="panel-caption">پس از اعمال بازه، وضعیت و سرویس</p>
            </div>
          </div>
          {sales.statusCounts.size === 0 ? <p className="empty-hint">سفارشی با این فیلترها وجود ندارد.</p> : (
            <div className="table-wrap"><table><thead><tr><th>وضعیت</th><th>تعداد</th><th>سهم</th></tr></thead><tbody>{[...sales.statusCounts.entries()].map(([status, value]) => <tr key={status}><td>{ORDER_STATUS_LABEL[status]}</td><td>{count(value)}</td><td>{percent(value, orders.length)}</td></tr>)}</tbody></table></div>
          )}
        </section>
      </div>

      <section className="report-section">
        <div className="panel-heading card panel report-heading-panel">
          <div>
            <h2 className="panel-title">عملیات، بهره‌وری و SLA</h2>
            <p className="panel-caption">فیلترهای بازه، صف، نوع عملیات و اپراتور اعمال شده‌اند.</p>
          </div>
          <Link href="/sla" className="order-id">گزارش SLA ←</Link>
        </div>
        {filteredItems === null ? (
          <div className="card panel"><p className="empty-hint">دادهٔ صف عملیات برای نقش فعلی در دسترس نیست. این بخش به مجوز مشاهدهٔ صف نیاز دارد.</p></div>
        ) : filteredItems.length === 0 ? (
          <div className="card panel"><p className="empty-hint">Work Item عملیاتی منطبق با فیلترها ثبت نشده است.</p></div>
        ) : (
          <SlaPerformanceReport items={filteredItems} embedded />
        )}
        {operationalItems?.length === 200 ? <p className="report-cap-note">API صف حداکثر ۲۰۰ Work Item برمی‌گرداند؛ گزارش عملیات به همین ۲۰۰ رکورد تازه محدود است.</p> : null}
      </section>

      <section className="card panel report-section report-limitations">
        <div className="panel-heading">
          <div><h2 className="panel-title">گزارش‌های در انتظار اتصال داده</h2><p className="panel-caption">تا زمان ارائهٔ منبع واقعی در API برای این موارد عددسازی نمی‌شود.</p></div>
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

function ReportFilterForm({ filters }: { filters: ReportFilters }) {
  return (
    <form action="/reports" method="get" className="card panel report-filter-form">
      <div className="report-filter-heading"><strong>فیلتر گزارش</strong><span>تقویم عملیاتی: تهران · حداکثر بازه ۳۶۶ روز</span></div>
      <div className="report-filter-grid">
        <label>از تاریخ<input type="date" name="from" defaultValue={filters.from} /></label>
        <label>تا تاریخ<input type="date" name="to" defaultValue={filters.to} /></label>
        <label>وضعیت سفارش<select name="status" defaultValue={filters.status ?? ""}><option value="">همهٔ وضعیت‌ها</option>{Object.entries(ORDER_STATUS_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>سرویس / محصول<input type="search" name="service" defaultValue={filters.service ?? ""} maxLength={120} placeholder="بخشی از نام محصول" /></label>
        <label>صف عملیات<select name="queueKey" defaultValue={filters.queueKey ?? ""}><option value="">همهٔ صف‌ها</option>{Object.entries(QUEUE_KEY_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>نوع عملیات<select name="type" defaultValue={filters.type ?? ""}><option value="">همهٔ انواع</option>{Object.entries(WORK_ITEM_TYPE_LABEL).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label>اپراتور<input type="search" name="operator" defaultValue={filters.operator ?? ""} maxLength={120} placeholder="نام یا شناسهٔ دقیق" /></label>
      </div>
      <div className="save-row report-filter-actions"><Link href="/reports" className="secondary-btn report-link">پاک کردن فیلترها</Link><button type="submit" className="primary-btn">اعمال فیلترها</button></div>
    </form>
  );
}

async function loadOperationalItems(staff: StaffUser): Promise<readonly WorkItemSummary[] | null> {
  if (!QUEUE_VIEW_ROLES.includes(staff.role as (typeof QUEUE_VIEW_ROLES)[number])) return null;
  try { return await workItems.list({ take: 200 }); } catch { return null; }
}

function calculateSales(orders: readonly OrderSummaryDto[], filters: ReportFilters) {
  const statusCounts = new Map<OrderStatus, number>();
  for (const order of orders) statusCounts.set(order.status, (statusCounts.get(order.status) ?? 0) + 1);
  const paid = orders.filter((order) => order.paidAt !== null);
  const days: { date: string; label: string; orders: number }[] = [];
  for (let cursor = filters.fromMs; cursor < filters.toExclusiveMs; cursor += 86_400_000) {
    const date = new Date(cursor + 210 * 60_000).toISOString().slice(0, 10);
    const value = orders.filter((order) => tehranDate(order.createdAt) === date).length;
    days.push({ date, label: toPersianDigits(date.slice(5).replace("-", "/")), orders: value });
  }
  const chartWasCapped = days.length > 31;
  const daily = chartWasCapped ? days.slice(-31) : days;
  return {
    statusCounts,
    paidOrders: paid.length,
    gmvIrr: paid.reduce((sum, order) => sum + BigInt(order.totalAmountIrr), 0n),
    fulfilled: statusCounts.get("FULFILLED") ?? 0,
    failed: statusCounts.get("FAILED") ?? 0,
    daily,
    chartWasCapped,
    maxDaily: Math.max(1, ...daily.map((day) => day.orders)),
  };
}

function tehranDate(iso: string): string { return new Date(new Date(iso).getTime() + 210 * 60_000).toISOString().slice(0, 10); }
function dateRangeLabel(filters: ReportFilters): string { return `${toPersianDigits(filters.from)} تا ${toPersianDigits(filters.to)}`; }
function count(value: number): string { return toPersianDigits(value.toLocaleString("en-US")); }
function percent(value: number, total: number): string { return total === 0 ? "—" : `${count(Math.round((value / total) * 100))}٪ از سفارش‌ها`; }

function ReportKpi({ icon, label, value, detail, accent = "#21b4b0", tint = "#dff7f5" }: { icon: React.ReactNode; label: string; value: string; detail: string; accent?: string; tint?: string }) {
  return <div className="card kpi" style={{ ["--accent" as string]: accent, ["--tint" as string]: tint }}><div className="kpi-top"><span>{label}</span><span className="kpi-icon">{icon}</span></div><p className="kpi-value">{value}</p><p className="kpi-trend trend-neutral">{detail}</p></div>;
}

function Capability({ label, reason }: { label: string; reason: string }) {
  return <div className="report-capability"><strong>{label}</strong><span>{reason}</span></div>;
}
