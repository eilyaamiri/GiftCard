import Link from "next/link";
import { formatToman, toPersianDigits } from "@barat/ui";
import { AlertTriangle, CheckCircle2, Clock3, ShoppingBag, Timer, Wallet, XCircle } from "lucide-react";
import { loadDashboardData } from "./dashboard-data";

export const metadata = { title: "داشبورد | پنل ادمین برات پی" };

const ORDER_STATUS_LABEL_FA: Record<string, string> = {
  DRAFT: "پیش‌نویس",
  AWAITING_PAYMENT: "در انتظار پرداخت",
  PAYMENT_PENDING: "در حال پرداخت",
  PAID: "پرداخت‌شده",
  FULFILLMENT_PENDING: "در صف تحویل",
  FULFILLING: "در حال تحویل",
  FULFILLED: "تحویل‌شده",
  FAILED: "ناموفق",
  REVIEW_REQUIRED: "نیازمند بررسی",
  REFUND_PENDING: "در انتظار بازگشت وجه",
  REFUNDED: "بازگشت‌وجه‌شده",
  CANCELLED: "لغوشده",
};

export default async function DashboardPage() {
  const data = await loadDashboardData();
  const maxVolume = Math.max(1, ...data.volume7d.map((d) => d.orders));

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">امروز، {toPersianDigits(new Date().toLocaleDateString("fa-IR"))}</p>
          <h1>داشبورد عملیات</h1>
        </div>
        <p className="muted">بر پایهٔ {toPersianDigits(String(data.totalOrders))} سفارش واقعی ثبت‌شده</p>
      </div>

      <div className="kpi-grid">
        <KpiCard
          icon={<ShoppingBag size={16} />}
          label="سفارش‌های امروز"
          value={toPersianDigits(String(data.ordersToday))}
          trend={`از مجموع ${toPersianDigits(String(data.totalOrders))} سفارش`}
          trendKind="neutral"
        />
        <KpiCard
          icon={<Wallet size={16} />}
          label="GMV پرداخت‌شده"
          value={formatToman(data.collectedGmvIrr)}
          trend="مجموع سفارش‌های دارای پرداخت"
          trendKind="neutral"
        />
        <KpiCard
          icon={<XCircle size={16} />}
          label="سفارش‌های ناموفق"
          value={toPersianDigits(String(data.failedOrders))}
          trend="نیازمند بررسی"
          trendKind={data.failedOrders > 0 ? "down" : "up"}
          accent="#d94a4a"
          tint="#fdeceb"
        />
        <KpiCard
          icon={<Clock3 size={16} />}
          label="در صف تحویل"
          value={toPersianDigits(String(data.pendingFulfillment))}
          trend="در صف اپراتور"
          trendKind="neutral"
          accent="#d98b19"
          tint="#fff3e0"
        />
        <KpiCard
          icon={<CheckCircle2 size={16} />}
          label="تحویل‌شده"
          value={toPersianDigits(String(data.fulfilledOrders))}
          trend="از مجموع سفارش‌ها"
          trendKind="up"
        />
        {data.avgFulfillmentMinutes === null ? (
          <EmptyKpiCard icon={<Timer size={16} />} label="میانگین زمان تحویل" reason="هنوز هیچ سفارشی تحویل‌شده نیست" />
        ) : (
          <KpiCard
            icon={<Timer size={16} />}
            label="میانگین زمان تحویل"
            value={`${toPersianDigits(String(data.avgFulfillmentMinutes))} دقیقه`}
            trend={`محاسبه‌شده از ${toPersianDigits(String(data.fulfilledOrders))} سفارش تحویل‌شده`}
            trendKind="neutral"
          />
        )}
        <EmptyKpiCard icon={<Wallet size={16} />} label="نرخ موفقیت پرداخت" reason="سرویس هنوز فهرست پرداخت‌های ادمین را ارائه نمی‌دهد" />
        <EmptyKpiCard icon={<Wallet size={16} />} label="درآمد خالص / حاشیهٔ سود" reason="داده‌های هزینه/حاشیه هنوز در دسترس API نیست" />
      </div>

      <div className="card panel" style={{ marginTop: 14 }}>
        <div className="panel-heading">
          <div>
            <p className="panel-caption" style={{ marginBottom: 3 }}>سلامت Providerهای FX</p>
          </div>
        </div>
        {data.fxError ? (
          <p className="empty-hint">{data.fxError}</p>
        ) : data.fx && data.fx.providers.length > 0 ? (
          <div className="attention-list">
            {data.fx.providers.map((provider) => (
              <div className="health" key={provider.provider} style={{ margin: 0, border: 0, padding: 0 }}>
                <span className="health-label">
                  <span
                    className={provider.isHealthy ? "dot-live" : undefined}
                    style={provider.isHealthy ? undefined : { width: 8, height: 8, borderRadius: "50%", background: "var(--red)", display: "inline-block" }}
                    aria-hidden="true"
                  />
                  {provider.provider}:{" "}
                  <span className={provider.isHealthy ? "freshness-good" : "freshness-bad"}>
                    {provider.isHealthy ? "متصل و به‌روز" : `قدیمی${provider.lastErrorCode ? ` — ${provider.lastErrorCode}` : ""}`}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-hint">هیچ Provider نرخ ارزی ثبت نشده است.</p>
        )}
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
            {data.volume7d.map((day) => (
              <div key={day.dateKey} className="bar-column">
                <span className="bar-value">{toPersianDigits(String(day.orders))}</span>
                <div
                  className="bar"
                  role="img"
                  aria-label={`${day.label}: ${toPersianDigits(String(day.orders))} سفارش`}
                  title={`${day.label}: ${toPersianDigits(String(day.orders))} سفارش`}
                  style={{ height: `${(day.orders / maxVolume) * 100}%` }}
                />
                <span className="bar-label">{day.label}</span>
              </div>
            ))}
          </div>

          <div className="panel-heading" style={{ marginTop: 26 }}>
            <div>
              <h2 className="panel-title">پرتکرارترین اقلام</h2>
              <p className="panel-caption">بر اساس تعداد سفارش، نه GMV</p>
            </div>
          </div>
          {data.topItems.length === 0 ? (
            <p className="empty-hint">هنوز سفارشی ثبت نشده است.</p>
          ) : (
            data.topItems.map((row) => (
              <div className="mix-row" key={row.title}>
                <span className="mix-dot" style={{ ["--dot" as string]: "#21b4b0" }} />
                <span className="mix-label">{row.title}</span>
                <span className="mix-track">
                  <span
                    className="mix-fill"
                    role="img"
                    aria-label={`${row.title}: ${toPersianDigits(String(row.count))} سفارش`}
                    title={`${row.title}: ${toPersianDigits(String(row.count))} سفارش`}
                    style={{ ["--dot" as string]: "#21b4b0", width: `${(row.count / (data.topItems[0]?.count || 1)) * 100}%` }}
                  />
                </span>
                <span className="mix-value">{toPersianDigits(String(row.count))}</span>
              </div>
            ))
          )}
        </div>

        <div className="card panel">
          <div className="panel-heading">
            <div>
              <h2 className="panel-title">نیازمند توجه</h2>
              <p className="panel-caption">سفارش‌هایی که در وضعیت «نیازمند بررسی» هستند</p>
            </div>
          </div>
          {data.reviewRequiredOrders.length === 0 ? (
            <p className="empty-hint">در حال حاضر موردی نیازمند بررسی نیست.</p>
          ) : (
            <div className="attention-list">
              {data.reviewRequiredOrders.map((order) => (
                <Link href={`/orders/${order.id}`} className="attention" key={order.id} style={{ textDecoration: "none" }}>
                  <span className="attention-icon">
                    <AlertTriangle size={16} />
                  </span>
                  <div>
                    <strong>{order.orderNumber}</strong>
                    <span>
                      {order.itemTitleFa} — {formatToman(BigInt(order.totalAmountIrr))}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card list-card" style={{ marginTop: 16 }}>
        <div className="panel-heading" style={{ padding: "21px 21px 0" }}>
          <div>
            <h2 className="panel-title">وضعیت سفارش‌ها</h2>
            <p className="panel-caption">شمارش کامل بر اساس وضعیت</p>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>وضعیت</th>
                <th>تعداد</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.statusCounts).map(([status, count]) => (
                <tr key={status}>
                  <td>{ORDER_STATUS_LABEL_FA[status] ?? status}</td>
                  <td>{toPersianDigits(String(count))}</td>
                </tr>
              ))}
            </tbody>
          </table>
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

/** For a metric the API cannot answer yet — never a fabricated number. */
function EmptyKpiCard({ icon, label, reason }: { icon: React.ReactNode; label: string; reason: string }) {
  return (
    <div className="card kpi" style={{ ["--tint" as string]: "#f1f3f5", ["--accent" as string]: "#6b7c93" }}>
      <div className="kpi-top">
        <span>{label}</span>
        <span className="kpi-icon">{icon}</span>
      </div>
      <p className="kpi-value" style={{ color: "var(--slate)", fontSize: 13, fontWeight: 700 }}>
        هنوز در دسترس نیست
      </p>
      <p className="kpi-trend trend-neutral">{reason}</p>
    </div>
  );
}
