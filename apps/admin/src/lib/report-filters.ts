import {
  orderStatusSchema,
  queueKeySchema,
  workItemTypeSchema,
  type OrderStatus,
  type OrderSummaryDto,
  type QueueKey,
  type WorkItemType,
} from "@barat/contracts";
import type { WorkItemSummary } from "@/app/(operator)/_lib/work-items";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const REPORT_ZONE_OFFSET = "+03:30";
const MAX_RANGE_DAYS = 366;

export interface ReportFilters {
  readonly from: string;
  readonly to: string;
  readonly fromMs: number;
  readonly toExclusiveMs: number;
  readonly status?: OrderStatus;
  readonly service?: string;
  readonly queueKey?: QueueKey;
  readonly type?: WorkItemType;
  readonly operator?: string;
}

function first(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const value = params[key];
  const single = Array.isArray(value) ? value[0] : value;
  return single?.trim() || undefined;
}

function dateOnlyAtTehranMidnight(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const calendarValue = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(calendarValue) || new Date(calendarValue).toISOString().slice(0, 10) !== date) return null;
  const value = Date.parse(`${date}T00:00:00${REPORT_ZONE_OFFSET}`);
  return Number.isFinite(value) ? value : null;
}

function isoDateInTehran(now: number): string {
  // Tehran has remained UTC+03:30 since 2023. Shifting then slicing gives the
  // business calendar date without relying on the deployment host timezone.
  return new Date(now + 210 * 60_000).toISOString().slice(0, 10);
}

function addCalendarDays(date: string, days: number): string {
  const utc = Date.parse(`${date}T00:00:00Z`);
  return new Date(utc + days * 86_400_000).toISOString().slice(0, 10);
}

function isQueueKey(value: string): value is QueueKey {
  return queueKeySchema.safeParse(value).success;
}

function isWorkItemType(value: string): value is WorkItemType {
  return workItemTypeSchema.safeParse(value).success;
}

function isOrderStatus(value: string): value is OrderStatus {
  return orderStatusSchema.safeParse(value).success;
}

export function readReportFilters(
  params: Record<string, string | string[] | undefined>,
  now = Date.now(),
): ReportFilters {
  const today = isoDateInTehran(now);
  const defaultFrom = addCalendarDays(today, -6);
  const rawFrom = first(params, "from");
  const rawTo = first(params, "to");
  let from = rawFrom && dateOnlyAtTehranMidnight(rawFrom) !== null ? rawFrom : defaultFrom;
  let to = rawTo && dateOnlyAtTehranMidnight(rawTo) !== null ? rawTo : today;
  let fromMs = dateOnlyAtTehranMidnight(from) as number;
  let toStartMs = dateOnlyAtTehranMidnight(to) as number;

  if (fromMs > toStartMs) {
    [from, to] = [to, from];
    [fromMs, toStartMs] = [toStartMs, fromMs];
  }
  if ((toStartMs - fromMs) / 86_400_000 >= MAX_RANGE_DAYS) {
    from = addCalendarDays(to, -(MAX_RANGE_DAYS - 1));
    fromMs = dateOnlyAtTehranMidnight(from) as number;
  }

  const status = first(params, "status");
  const queueKey = first(params, "queueKey");
  const type = first(params, "type");
  const service = first(params, "service")?.slice(0, 120);
  const operator = first(params, "operator")?.slice(0, 120);
  const nextDate = addCalendarDays(to, 1);

  return {
    from,
    to,
    fromMs,
    toExclusiveMs: dateOnlyAtTehranMidnight(nextDate) as number,
    ...(status && isOrderStatus(status) ? { status } : {}),
    ...(service ? { service } : {}),
    ...(queueKey && isQueueKey(queueKey) ? { queueKey } : {}),
    ...(type && isWorkItemType(type) ? { type } : {}),
    ...(operator ? { operator } : {}),
  };
}

export function filterReportOrders(orders: readonly OrderSummaryDto[], filters: ReportFilters): OrderSummaryDto[] {
  const service = filters.service?.toLocaleLowerCase("fa-IR");
  return orders.filter((order) => {
    const createdAt = new Date(order.createdAt).getTime();
    return createdAt >= filters.fromMs
      && createdAt < filters.toExclusiveMs
      && (!filters.status || order.status === filters.status)
      && (!service || order.itemTitleFa.toLocaleLowerCase("fa-IR").includes(service));
  });
}

export function filterReportWorkItems(items: readonly WorkItemSummary[], filters: ReportFilters): WorkItemSummary[] {
  const operator = filters.operator?.toLocaleLowerCase("fa-IR");
  return items.filter((item) => {
    const createdAt = new Date(item.createdAt).getTime();
    const operatorMatches = !operator
      || item.assignedToStaffId?.toLocaleLowerCase("fa-IR") === operator
      || item.assignedToStaffName?.toLocaleLowerCase("fa-IR").includes(operator);
    return createdAt >= filters.fromMs
      && createdAt < filters.toExclusiveMs
      && (!filters.queueKey || item.queueKey === filters.queueKey)
      && (!filters.type || item.type === filters.type)
      && operatorMatches;
  });
}
