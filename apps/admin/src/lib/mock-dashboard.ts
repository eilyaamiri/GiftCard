/**
 * Placeholder dashboard data shaped exactly like the future API response.
 * Replace with a real fetch to `/api/admin/dashboard` once B7 (reporting) ships
 * the aggregate endpoint — the page component below does not know the
 * difference, it only reads this shape.
 */
export interface DashboardSnapshot {
  kpis: {
    ordersToday: number;
    gmvIrr: bigint;
    netRevenueIrr: bigint;
    grossMarginBps: number;
    contributionIrr: bigint;
    failedOrders: number;
    pendingFulfillment: number;
    paymentSuccessRateBps: number;
    avgFulfillmentMinutes: number;
    usdIrrRate: bigint;
    fxProviderHealthy: boolean;
  };
  volume7d: { label: string; orders: number }[];
  serviceMix: { label: string; shareBps: number; color: string }[];
  attention: { title: string; detail: string }[];
}

export const dashboardSnapshot: DashboardSnapshot = {
  kpis: {
    ordersToday: 47,
    gmvIrr: 942_000_000n,
    netRevenueIrr: 75_360_000n,
    grossMarginBps: 800,
    contributionIrr: 54_520_000n,
    failedOrders: 3,
    pendingFulfillment: 11,
    paymentSuccessRateBps: 9430,
    avgFulfillmentMinutes: 18,
    usdIrrRate: 1_920_000n,
    fxProviderHealthy: true,
  },
  volume7d: [
    { label: "شنبه", orders: 32 },
    { label: "یک‌شنبه", orders: 41 },
    { label: "دوشنبه", orders: 38 },
    { label: "سه‌شنبه", orders: 45 },
    { label: "چهارشنبه", orders: 52 },
    { label: "پنج‌شنبه", orders: 60 },
    { label: "امروز", orders: 47 },
  ],
  serviceMix: [
    { label: "گیفت‌کارت اپل", shareBps: 3200, color: "#21b4b0" },
    { label: "گوگل‌پلی", shareBps: 1800, color: "#46d0cb" },
    { label: "پرداخت SaaS", shareBps: 2400, color: "#7157d9" },
    { label: "استیم / پلی‌استیشن", shareBps: 1400, color: "#d98b19" },
    { label: "سایر", shareBps: 1200, color: "#6b7c93" },
  ],
  attention: [
    { title: "۳ سفارش پرداخت‌شده بدون تخصیص اپراتور", detail: "بیش از ۲۰ دقیقه در صف مانده‌اند — SLA در خطر" },
    { title: "نرخ FX منبع اصلی ۹ دقیقه است", detail: "در آستانهٔ stale شدن — منبع دوم آماده جایگزینی است" },
    { title: "۱ اختلاف هزینهٔ تأمین‌کننده بیش از سقف مجاز", detail: "سفارش #BP-10432 نیازمند تأیید مدیر" },
  ],
};
