import { z } from "zod";
import { Activity, AlertTriangle, CheckCircle2, Clock, Database, Server, XCircle, Zap } from "lucide-react";
import { formatJalaliDate, toPersianDigits } from "@barat/ui";
import { REPORT_ROLES } from "@/lib/api";
import { requireRole } from "@/lib/session";
import Link from "next/link";

export const metadata = { title: "مانیتورینگ | پنل ادمین سنتو" };

const monitoringSchema = z.object({
  server: z.object({
    status: z.enum(["OPERATIONAL", "DEGRADED", "DOWN"]),
    uptimeSeconds: z.number(),
    uptimeFormatted: z.string(),
    heapUsedMb: z.number(),
    heapTotalMb: z.number(),
    heapPercent: z.number(),
    eventLoopLagMs: z.number(),
    activeHandles: z.number(),
    lastCheckAt: z.string(),
  }),
  fxProviders: z.array(
    z.object({
      provider: z.string(),
      status: z.enum(["HEALTHY", "DEGRADED", "OFFLINE", "UNKNOWN"]),
      isHealthy: z.boolean(),
      lastSuccessAt: z.string().nullable(),
      lastErrorAt: z.string().nullable(),
      lastErrorCode: z.string().nullable(),
      consecutiveFailures: z.number(),
    })
  ),
  suppliers: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      status: z.enum(["HEALTHY", "DEGRADED", "OFFLINE", "UNKNOWN"]),
      balanceAmount: z.string().nullable(),
      balanceCurrency: z.string().nullable(),
      lastCheckAt: z.string().nullable(),
      errorMessage: z.string().nullable(),
    })
  ),
  stuckOrders: z.array(
    z.object({
      orderId: z.string(),
      orderNumber: z.string(),
      status: z.string(),
      stuckSince: z.string(),
      stuckMinutes: z.number(),
      hasWorkItem: z.boolean(),
    })
  ),
  /* Defaulted so an admin deployed ahead of the API still renders the rest. */
  paymentGateways: z
    .array(
      z.object({
        provider: z.string(),
        status: z.enum(["HEALTHY", "DEGRADED", "OFFLINE", "UNKNOWN"]),
        windowMinutes: z.number(),
        calls: z.number(),
        okCalls: z.number(),
        declinedCalls: z.number(),
        connectionFailures: z.number(),
        lastOkAt: z.string().nullable(),
        lastConnectionFailureAt: z.string().nullable(),
      })
    )
    .default([]),
  recentAlerts: z
    .array(
      z.object({
        severity: z.string(),
        source: z.string(),
        message: z.string(),
        at: z.string(),
      })
    )
    .default([]),
  generatedAt: z.string(),
});

type MonitoringSnapshot = z.infer<typeof monitoringSchema>;

async function fetchMonitoring(): Promise<MonitoringSnapshot | null> {
  const base =
    (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/$/, "");
  try {
    const { cookies } = await import("next/headers");
    const store = await cookies();
    const header = store.toString();
    const response = await fetch(`${base}/api/admin/monitoring`, {
      headers: header ? { cookie: header } : {},
      cache: "no-store",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return monitoringSchema.parse(data);
  } catch {
    return null;
  }
}

export default async function MonitoringPage() {
  await requireRole(REPORT_ROLES);
  const snapshot = await fetchMonitoring();

  return (
    <div>
      <div className="page-heading">
        <div>
          <p className="eyebrow">وضعیت سرویس‌ها</p>
          <h1>مانیتورینگ API و سرور</h1>
        </div>
        <div className="report-source">
          <Activity size={16} aria-hidden="true" />
          <span>آخرین به‌روزرسانی: {snapshot ? formatJalaliDate(snapshot.generatedAt) : "—"}</span>
        </div>
      </div>

      {snapshot === null ? (
        <div className="card panel">
          <p className="empty-hint">دادهٔ مانیتورینگ در دسترس نیست. ممکن است مجوز لازم را نداشته باشید.</p>
        </div>
      ) : (
        <>
          {/* KPI Row */}
          <div className="kpi-grid">
            <ServerStatusCard server={snapshot.server} />
            <FxSummaryCard providers={snapshot.fxProviders} />
            <SupplierSummaryCard suppliers={snapshot.suppliers} />
            <StuckOrdersCard orders={snapshot.stuckOrders} />
          </div>

          {/* Details Grid */}
          <div className="dashboard-grid report-grid">
            <FxProvidersPanel providers={snapshot.fxProviders} />
            <SuppliersPanel suppliers={snapshot.suppliers} />
          </div>

          <div className="dashboard-grid report-grid">
            <PaymentGatewaysPanel gateways={snapshot.paymentGateways} />
            <RecentAlertsPanel alerts={snapshot.recentAlerts} />
          </div>

          {/* Stuck Orders */}
          {snapshot.stuckOrders.length > 0 && (
            <StuckOrdersPanel orders={snapshot.stuckOrders} />
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* KPI Cards                                                                   */
/* -------------------------------------------------------------------------- */

function ServerStatusCard({ server }: { server: MonitoringSnapshot["server"] }) {
  const statusConfig = {
    OPERATIONAL: { color: "#18a66a", bg: "#e7f7f0", icon: <CheckCircle2 size={16} />, label: "سالم" },
    DEGRADED: { color: "#d98324", bg: "#fdf1e3", icon: <AlertTriangle size={16} />, label: "کند" },
    DOWN: { color: "#d94a4a", bg: "#fdeceb", icon: <XCircle size={16} />, label: "قطع" },
  }[server.status];

  return (
    <div className="card kpi" style={{ ["--accent" as string]: statusConfig.color, ["--tint" as string]: statusConfig.bg }}>
      <div className="kpi-top">
        <span>وضعیت سرور</span>
        <span className="kpi-icon"><Server size={16} /></span>
      </div>
      <p className="kpi-value">{statusConfig.label}</p>
      <p className="kpi-trend trend-neutral">
        Uptime: {server.uptimeFormatted} · Heap: {toPersianDigits(server.heapPercent)}٪
      </p>
    </div>
  );
}

function FxSummaryCard({ providers }: { providers: MonitoringSnapshot["fxProviders"] }) {
  const healthy = providers.filter((p) => p.status === "HEALTHY").length;
  const total = providers.length;
  const allHealthy = healthy === total && total > 0;
  const color = allHealthy ? "#18a66a" : total === 0 ? "#6b7280" : "#d98324";
  const bg = allHealthy ? "#e7f7f0" : total === 0 ? "#f3f4f6" : "#fdf1e3";

  return (
    <div className="card kpi" style={{ ["--accent" as string]: color, ["--tint" as string]: bg }}>
      <div className="kpi-top">
        <span>نرخ ارز</span>
        <span className="kpi-icon"><Zap size={16} /></span>
      </div>
      <p className="kpi-value">{toPersianDigits(healthy)}/{toPersianDigits(total)}</p>
      <p className="kpi-trend trend-neutral">
        {allHealthy ? "همه سالم" : healthy === 0 ? "همه قطع!" : `${toPersianDigits(total - healthy)} مشکل‌دار`}
      </p>
    </div>
  );
}

function SupplierSummaryCard({ suppliers }: { suppliers: MonitoringSnapshot["suppliers"] }) {
  const healthy = suppliers.filter((s) => s.status === "HEALTHY").length;
  const offline = suppliers.filter((s) => s.status === "OFFLINE").length;
  const total = suppliers.length;
  const allHealthy = healthy === total && total > 0;
  const color = allHealthy ? "#18a66a" : offline > 0 ? "#d94a4a" : "#d98324";
  const bg = allHealthy ? "#e7f7f0" : offline > 0 ? "#fdeceb" : "#fdf1e3";

  return (
    <div className="card kpi" style={{ ["--accent" as string]: color, ["--tint" as string]: bg }}>
      <div className="kpi-top">
        <span>تأمین‌کنندگان</span>
        <span className="kpi-icon"><Database size={16} /></span>
      </div>
      <p className="kpi-value">{toPersianDigits(healthy)}/{toPersianDigits(total)}</p>
      <p className="kpi-trend trend-neutral">
        {allHealthy ? "همه فعال" : offline > 0 ? `${toPersianDigits(offline)} قطع` : "ناشناخته"}
      </p>
    </div>
  );
}

function StuckOrdersCard({ orders }: { orders: MonitoringSnapshot["stuckOrders"] }) {
  const count = orders.length;
  const hasStuck = count > 0;
  const color = hasStuck ? "#d94a4a" : "#18a66a";
  const bg = hasStuck ? "#fdeceb" : "#e7f7f0";

  return (
    <div className="card kpi" style={{ ["--accent" as string]: color, ["--tint" as string]: bg }}>
      <div className="kpi-top">
        <span>سفارش گیرکرده</span>
        <span className="kpi-icon"><Clock size={16} /></span>
      </div>
      <p className="kpi-value">{toPersianDigits(count)}</p>
      <p className="kpi-trend trend-neutral">
        {hasStuck ? `قدیمی‌ترین: ${toPersianDigits(orders[0]?.stuckMinutes ?? 0)} دقیقه` : "بدون مشکل"}
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail Panels                                                               */
/* -------------------------------------------------------------------------- */

function FxProvidersPanel({ providers }: { providers: MonitoringSnapshot["fxProviders"] }) {
  return (
    <section className="card panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">وضعیت FX Providers</h2>
          <p className="panel-caption">نرخ‌دهندگان ارز</p>
        </div>
      </div>
      {providers.length === 0 ? (
        <p className="empty-hint">هیچ provider نرخ ارز ثبت نشده است.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>وضعیت</th>
                <th>آخرین موفقیت</th>
                <th>خطاهای متوالی</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="bp-ltr">{p.lastSuccessAt ? formatJalaliDate(p.lastSuccessAt) : "—"}</td>
                  <td>{toPersianDigits(p.consecutiveFailures)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SuppliersPanel({ suppliers }: { suppliers: MonitoringSnapshot["suppliers"] }) {
  return (
    <section className="card panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">وضعیت تأمین‌کنندگان</h2>
          <p className="panel-caption">Reloadly, Tillo, FazerCards, ...</p>
        </div>
      </div>
      {suppliers.length === 0 ? (
        <p className="empty-hint">هیچ تأمین‌کننده‌ای ثبت نشده است.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>تأمین‌کننده</th>
                <th>وضعیت</th>
                <th>موجودی</th>
                <th>آخرین بررسی</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((s) => (
                <tr key={s.key}>
                  <td>{s.name}</td>
                  <td><StatusBadge status={s.status} /></td>
                  <td>
                    {s.balanceAmount && s.balanceCurrency
                      ? `${s.balanceAmount} ${s.balanceCurrency}`
                      : "—"}
                  </td>
                  <td className="bp-ltr">{s.lastCheckAt ? formatJalaliDate(s.lastCheckAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StuckOrdersPanel({ orders }: { orders: MonitoringSnapshot["stuckOrders"] }) {
  return (
    <section className="card panel report-section">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">سفارش‌های گیرکرده</h2>
          <p className="panel-caption">
            سفارش‌هایی که بیش از ۱۵ دقیقه در وضعیت PAID/FULFILLMENT_PENDING یا بیش از ۱۰ دقیقه در FULFILLING مانده‌اند
          </p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>شماره سفارش</th>
              <th>وضعیت</th>
              <th>مدت توقف</th>
              <th>Work Item</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.orderId}>
                <td>{o.orderNumber}</td>
                <td><code className="status-badge">{o.status}</code></td>
                <td>{toPersianDigits(o.stuckMinutes)} دقیقه</td>
                <td>{o.hasWorkItem ? "✓" : "✗"}</td>
                <td>
                  <Link href={`/orders/${o.orderId}`} className="order-id">
                    مشاهده
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PaymentGatewaysPanel({ gateways }: { gateways: MonitoringSnapshot["paymentGateways"] }) {
  return (
    <section className="card panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">وضعیت درگاه‌های پرداخت</h2>
          <p className="panel-caption">
            از روی تلاش‌های پرداخت یک ساعت اخیر؛ درگاه هرگز مستقیم تست نمی‌شود. پرداخت ردشده خطای درگاه نیست.
          </p>
        </div>
      </div>
      {gateways.length === 0 ? (
        <p className="empty-hint">در یک ساعت اخیر تراکنشی با درگاه انجام نشده است؛ وضعیتی برای گزارش نیست.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>درگاه</th>
                <th>وضعیت</th>
                <th>موفق / کل</th>
                <th>خطای اتصال</th>
                <th>آخرین موفقیت</th>
              </tr>
            </thead>
            <tbody>
              {gateways.map((g) => (
                <tr key={g.provider}>
                  <td>{g.provider}</td>
                  <td><StatusBadge status={g.status} /></td>
                  <td>{toPersianDigits(g.okCalls)} / {toPersianDigits(g.calls)}</td>
                  <td>{toPersianDigits(g.connectionFailures)}</td>
                  <td className="bp-ltr">{g.lastOkAt ? formatJalaliDate(g.lastOkAt) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const ALERT_SEVERITY_STYLE: Record<string, { color: string; bg: string; label: string }> = {
  CRITICAL: { color: "#d94a4a", bg: "#fdeceb", label: "بحرانی" },
  ERROR: { color: "#d94a4a", bg: "#fdeceb", label: "خطا" },
  WARNING: { color: "#d98324", bg: "#fdf1e3", label: "هشدار" },
  INFO: { color: "#18a66a", bg: "#e7f7f0", label: "اطلاع" },
};

function RecentAlertsPanel({ alerts }: { alerts: MonitoringSnapshot["recentAlerts"] }) {
  return (
    <section className="card panel">
      <div className="panel-heading">
        <div>
          <h2 className="panel-title">هشدارهای اخیر</h2>
          <p className="panel-caption">
            ۲۰ هشدار آخر. فقط خطا و بحرانی به تلگرام می‌رود. با ری‌استارت سرور پاک می‌شود.
          </p>
        </div>
      </div>
      {alerts.length === 0 ? (
        <p className="empty-hint">از آخرین راه‌اندازی سرور هشداری ثبت نشده است.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>زمان</th>
                <th>سطح</th>
                <th>منبع</th>
                <th>پیام</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a, index) => {
                const style = ALERT_SEVERITY_STYLE[a.severity] ?? { color: "#6b7280", bg: "#f3f4f6", label: a.severity };
                return (
                  <tr key={`${a.at}-${index}`}>
                    <td className="bp-ltr">{formatJalaliDate(a.at)}</td>
                    <td>
                      <span
                        className="status-badge"
                        style={{ backgroundColor: style.bg, color: style.color, padding: "2px 8px", borderRadius: "4px", fontSize: "0.85em" }}
                      >
                        {style.label}
                      </span>
                    </td>
                    <td>{a.source}</td>
                    <td className="bp-ltr">{a.message}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared Components                                                           */
/* -------------------------------------------------------------------------- */

function StatusBadge({ status }: { status: "HEALTHY" | "DEGRADED" | "OFFLINE" | "UNKNOWN" }) {
  const config = {
    HEALTHY: { color: "#18a66a", bg: "#e7f7f0", label: "سالم" },
    DEGRADED: { color: "#d98324", bg: "#fdf1e3", label: "کند" },
    OFFLINE: { color: "#d94a4a", bg: "#fdeceb", label: "قطع" },
    UNKNOWN: { color: "#6b7280", bg: "#f3f4f6", label: "ناشناخته" },
  }[status];

  return (
    <span
      className="status-badge"
      style={{
        backgroundColor: config.bg,
        color: config.color,
        padding: "2px 8px",
        borderRadius: "4px",
        fontSize: "0.85em",
      }}
    >
      {config.label}
    </span>
  );
}
