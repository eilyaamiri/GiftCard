import { z } from "zod";
import type { OrderStatus, OrderSummaryDto } from "@barat/contracts";
import { fxProviderHealthSchema, orderSummaryDtoSchema, paginationMetaSchema } from "@barat/contracts";
import { api } from "@/lib/api";

/**
 * Real aggregates only. There is no /api/admin/dashboard or /api/admin/reports
 * endpoint (confirmed against the live route table on 2026-08-31), so every
 * number here is computed from `/api/admin/orders` and `/api/fx/health` — the
 * only admin-scope endpoints that exist. Anything that would need a payment
 * ledger, a margin/cost figure or an audit feed is left out on purpose; the
 * page renders an honest empty state for those instead of a guess.
 */

const ordersPageSchema = z.object({
  items: z.array(orderSummaryDtoSchema),
  meta: paginationMetaSchema,
});

const fxHealthSchema = z.object({ providers: z.array(fxProviderHealthSchema) });

const MAX_PAGES = 25; // 100/page cap × 25 = 2,500 orders — well past today's 80-row seed.

/** Pages through every admin order once, newest pageSize (100) at a time. */
async function fetchAllOrders(): Promise<OrderSummaryDto[]> {
  const items: OrderSummaryDto[] = [];
  let page = 1;
  for (;;) {
    const batch = await api.get(`/api/admin/orders?page=${page}&pageSize=100`, ordersPageSchema);
    items.push(...batch.items);
    if (page >= batch.meta.totalPages || page >= MAX_PAGES) break;
    page += 1;
  }
  return items;
}

const PENDING_FULFILLMENT_STATUSES: OrderStatus[] = ["FULFILLMENT_PENDING", "FULFILLING"];

export interface DashboardData {
  totalOrders: number;
  ordersToday: number;
  statusCounts: Partial<Record<OrderStatus, number>>;
  failedOrders: number;
  reviewRequiredOrders: OrderSummaryDto[];
  pendingFulfillment: number;
  fulfilledOrders: number;
  /** Sum of `totalAmountIrr` over orders that have actually been paid (`paidAt` set). */
  collectedGmvIrr: bigint;
  /** Minutes between `createdAt` and `fulfilledAt`, only over orders that reached FULFILLED. */
  avgFulfillmentMinutes: number | null;
  volume7d: { dateKey: string; label: string; orders: number }[];
  topItems: { title: string; count: number }[];
  fx: { providers: { provider: string; isHealthy: boolean; lastErrorCode: string | null }[] } | null;
  fxError: string | null;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function loadDashboardData(): Promise<DashboardData> {
  const orders = await fetchAllOrders();

  const statusCounts: Partial<Record<OrderStatus, number>> = {};
  for (const order of orders) {
    statusCounts[order.status] = (statusCounts[order.status] ?? 0) + 1;
  }

  const todayKey = dayKey(new Date().toISOString());
  const ordersToday = orders.filter((order) => dayKey(order.createdAt) === todayKey).length;

  const collectedGmvIrr = orders
    .filter((order) => order.paidAt !== null)
    .reduce((sum, order) => sum + BigInt(order.totalAmountIrr), 0n);

  const fulfilled = orders.filter((order) => order.status === "FULFILLED" && order.fulfilledAt !== null);
  const avgFulfillmentMinutes =
    fulfilled.length === 0
      ? null
      : Math.round(
          fulfilled.reduce((sum, order) => {
            const minutes = (new Date(order.fulfilledAt as string).getTime() - new Date(order.createdAt).getTime()) / 60_000;
            return sum + minutes;
          }, 0) / fulfilled.length,
        );

  // Last 7 calendar days including today, oldest first.
  const dayLabels = ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنج‌شنبه", "جمعه", "شنبه"];
  const volume7d: { dateKey: string; label: string; orders: number }[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - offset);
    const key = dayKey(date.toISOString());
    const label = offset === 0 ? "امروز" : (dayLabels[date.getUTCDay()] ?? "");
    const count = orders.filter((order) => dayKey(order.createdAt) === key).length;
    volume7d.push({ dateKey: key, label, orders: count });
  }

  const itemCounts = new Map<string, number>();
  for (const order of orders) {
    itemCounts.set(order.itemTitleFa, (itemCounts.get(order.itemTitleFa) ?? 0) + 1);
  }
  const topItems = [...itemCounts.entries()]
    .map(([title, count]) => ({ title, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  let fx: DashboardData["fx"] = null;
  let fxError: string | null = null;
  try {
    const health = await api.get("/api/fx/health", fxHealthSchema);
    fx = { providers: health.providers.map((p) => ({ provider: p.provider, isHealthy: p.isHealthy, lastErrorCode: p.lastErrorCode })) };
  } catch {
    fxError = "دریافت وضعیت Provider های FX ممکن نشد.";
  }

  return {
    totalOrders: orders.length,
    ordersToday,
    statusCounts,
    failedOrders: statusCounts.FAILED ?? 0,
    reviewRequiredOrders: orders.filter((order) => order.status === "REVIEW_REQUIRED"),
    pendingFulfillment: PENDING_FULFILLMENT_STATUSES.reduce((sum, status) => sum + (statusCounts[status] ?? 0), 0),
    fulfilledOrders: statusCounts.FULFILLED ?? 0,
    collectedGmvIrr,
    avgFulfillmentMinutes,
    volume7d,
    topItems,
    fx,
    fxError,
  };
}
