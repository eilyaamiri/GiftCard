import { formatToman, toPersianDigits } from "@barat/ui";
import { dashboardSnapshot } from "@/lib/mock-dashboard";
import { formatBps } from "@/lib/format-bps";
import {
  ShoppingBag,
  Wallet,
  TrendingUp,
  PiggyBank,
  XCircle,
  Clock3,
  CheckCircle2,
  Timer,
  Coins,
  AlertTriangle,
} from "lucide-react";

export const metadata = { title: "داشبورد | پنل ادمین برات پی" };

export default function DashboardPage() {
  const { kpis, volume7d, serviceMix, attention } = dashboardSnapshot;
  const maxOrders = Math.max(...volume7d.map((d) => d.orders));

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">امروز، {toPersianDigits(new Date().toLocaleDateString("fa-IR"))}</p>
          <h1>داشبورد عملیات</h1>
        </div>
        <p className="muted">آخرین به‌روزرسانی چند ثانیه پیش</p>
      </div>

      <div className="kpi-grid">
        <KpiCard icon={<ShoppingBag size={16} />} label="سفارش‌های امروز" value={toPersianDigits(String(kpis.ordersToday))} trend="+۱۲٪ نسبت به دیروز" trendKind="up" />
        <KpiCard icon={<Wallet size={16} />} label="GMV" value={formatToman(kpis.gmvIrr)} trend="+۸٪ نسبت به دیروز" trendKind="up" />
        <KpiCard icon={<Coins size={16} />} label="درآمد خالص" value={formatToman(kpis.netRevenueIrr)} trend={`حاشیهٔ ناخالص ${formatBps(kpis.grossMarginBps)}`} trendKind="neutral" />
        <KpiCard icon={<PiggyBank size={16} />} label="Contribution" value={formatToman(kpis.contributionIrr)} trend="مثبت و پایدار" trendKind="up" accent="#7157d9" tint="#efeafc" />
        <KpiCard icon={<XCircle size={16} />} label="سفارش‌های ناموفق" value={toPersianDigits(String(kpis.failedOrders))} trend="نیازمند بررسی" trendKind="down" accent="#d94a4a" tint="#fdeceb" />
        <KpiCard icon={<Clock3 size={16} />} label="در انتظار تحویل" value={toPersianDigits(String(kpis.pendingFulfillment))} trend="در صف اپراتور" trendKind="neutral" accent="#d98b19" tint="#fff3e0" />
        <KpiCard icon={<CheckCircle2 size={16} />} label="نرخ موفقیت پرداخت" value={formatBps(kpis.paymentSuccessRateBps)} trend="طبیعی" trendKind="up" />
        <KpiCard icon={<Timer size={16} />} label="میانگین زمان تحویل" value={`${toPersianDigits(String(kpis.avgFulfillmentMinutes))} دقیقه`} trend="زیر SLA هدف" trendKind="up" />
      </div>

      <div className="card panel" style={{ marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="kpi-icon" style={{ ["--tint" as string]: "#eaf4ff", ["--accent" as string]: "#2b69a0" }}>
            <TrendingUp size={16} />
          </div>
          <div>
            <p className="panel-caption" style={{ marginBottom: 3 }}>نرخ برنامه‌ریزی USD/IRR</p>
            <p style={{ margin: 0, fontWeight: 800, color: "var(--ink)" }} className="bp-ltr">{formatToman(kpis.usdIrrRate)}</p>
          </div>
        </div>
        <div className="health" style={{ margin: 0, border: 0, padding: 0 }}>
          <span className="health-label">
            <span className="dot-live" aria-hidden="true" />
            سلامت Provider FX: {kpis.fxProviderHealthy ? "متصل و به‌روز" : "قدیمی"}
          </span>
        </div>
      </div>

      <div className="dashboard-grid">
        <div className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">حجم سفارش‌ها — ۷ روز اخیر</h2>
              <p className="panel-caption">تعداد سفارش‌های ثبت‌شده در روز</p>
            </div>
          </div>
          <div className="volume-chart">
            {volume7d.map((day) => (
              <div key={day.label} className="bar-column">
                <span className="bar-value">{toPersianDigits(String(day.orders))}</span>
                <div
                  className="bar"
                  role="img"
                  aria-label={`${day.label}: ${toPersianDigits(String(day.orders))} سفارش`}
                  title={`${day.label}: ${toPersianDigits(String(day.orders))} سفارش`}
                  style={{ height: `${(day.orders / maxOrders) * 100}%` }}
                />
                <span className="bar-label">{day.label}</span>
              </div>
            ))}
          </div>

          <div className="panel-heading" style={{ marginTop: 26 }}>
            <div>
              <h2 className="panel-title">ترکیب سرویس‌ها</h2>
              <p className="panel-caption">سهم هر سرویس از GMV</p>
            </div>
          </div>
          {serviceMix.map((row) => (
            <div className="mix-row" key={row.label}>
              <span className="mix-dot" style={{ ["--dot" as string]: row.color }} />
              <span className="mix-label">{row.label}</span>
              <span className="mix-track">
                <span
                  className="mix-fill"
                  role="img"
                  aria-label={`${row.label}: ${formatBps(row.shareBps)} از GMV`}
                  title={`${row.label}: ${formatBps(row.shareBps)} از GMV`}
                  style={{ ["--dot" as string]: row.color, width: `${row.shareBps / 100}%` }}
                />
              </span>
              <span className="mix-value">{formatBps(row.shareBps)}</span>
            </div>
          ))}
        </div>

        <div className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">نیازمند توجه</h2>
              <p className="panel-caption">مواردی که ممکن است SLA یا صحت مالی را تهدید کنند</p>
            </div>
          </div>
          <div className="attention-list">
            {attention.map((item) => (
              <div className="attention" key={item.title}>
                <span className="attention-icon">
                  <AlertTriangle size={16} />
                </span>
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  trend,
  trendKind,
  accent = "#21b4b0",
  tint = "#dff7f5",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend: string;
  trendKind: "up" | "down" | "neutral";
  accent?: string;
  tint?: string;
}) {
  return (
    <div className="card kpi" style={{ ["--tint" as string]: tint, ["--accent" as string]: accent }}>
      <div className="kpi-top">
        <span>{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <p className="kpi-value">{value}</p>
      <p className={`kpi-trend trend-${trendKind}`}>{trend}</p>
    </div>
  );
}
