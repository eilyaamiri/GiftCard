import type { WorkItemStatus, WorkItemType, QueueKey } from "@barat/contracts";

const TERMINAL = new Set<WorkItemStatus>(["COMPLETED", "FAILED", "CANCELLED"]);
const NEAR_SLA_WINDOW_MS = 30 * 60_000;

export interface SlaMetricItem {
  readonly status: WorkItemStatus;
  readonly type: WorkItemType;
  readonly queueKey: QueueKey;
  readonly assignedToStaffId: string | null;
  readonly assignedToStaffName?: string | null;
  readonly createdAt: string;
  readonly assignedAt: string | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly dueAt: string | null;
  readonly slaBreachedAt?: string | null;
}

export interface SlaBreakdownRow {
  readonly key: string;
  readonly count: number;
  readonly completed: number;
  readonly breached: number;
}

export interface OperatorPerformanceRow extends SlaBreakdownRow {
  readonly label: string;
  readonly averageCompletionMinutes: number | null;
}

export interface SlaMetrics {
  readonly total: number;
  readonly open: number;
  readonly inProgress: number;
  readonly completed: number;
  readonly completedToday: number;
  readonly overdueOpen: number;
  readonly nearSla: number;
  readonly evaluated: number;
  readonly met: number;
  readonly breached: number;
  readonly slaMetPercent: number | null;
  readonly averageQueueWaitMinutes: number | null;
  readonly averageTimeToStartMinutes: number | null;
  readonly averageCompletionMinutes: number | null;
  readonly byStatus: readonly SlaBreakdownRow[];
  readonly byType: readonly SlaBreakdownRow[];
  readonly byQueue: readonly SlaBreakdownRow[];
  readonly byOperator: readonly OperatorPerformanceRow[];
}

function timestamp(value: string): number {
  return new Date(value).getTime();
}

function minutes(start: string, end: string): number {
  return Math.max(0, Math.round((timestamp(end) - timestamp(start)) / 60_000));
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function isTerminal(item: SlaMetricItem): boolean {
  return TERMINAL.has(item.status);
}

/** A terminal item meets SLA only when it completed successfully by its deadline. */
function metSla(item: SlaMetricItem): boolean {
  return item.status === "COMPLETED" && item.completedAt !== null && item.dueAt !== null && timestamp(item.completedAt) <= timestamp(item.dueAt);
}

function breachedSla(item: SlaMetricItem, now: number): boolean {
  if (item.dueAt === null) return false;
  if (item.slaBreachedAt) return true;
  if (isTerminal(item)) return !metSla(item);
  return timestamp(item.dueAt) < now;
}

function breakdown(items: readonly SlaMetricItem[], keyFor: (item: SlaMetricItem) => string, now: number): SlaBreakdownRow[] {
  const rows = new Map<string, SlaBreakdownRow>();
  for (const item of items) {
    const key = keyFor(item);
    const current = rows.get(key) ?? { key, count: 0, completed: 0, breached: 0 };
    rows.set(key, {
      key,
      count: current.count + 1,
      completed: current.completed + (item.status === "COMPLETED" ? 1 : 0),
      breached: current.breached + (breachedSla(item, now) ? 1 : 0),
    });
  }
  return [...rows.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function calculateSlaMetrics(items: readonly SlaMetricItem[], now: number): SlaMetrics {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const startMs = start.getTime();
  const endMs = end.getTime();

  const open = items.filter((item) => !isTerminal(item));
  const evaluated = items.filter((item) => item.dueAt !== null && isTerminal(item));
  const successful = items.filter((item) => item.status === "COMPLETED" && item.completedAt !== null);
  const met = evaluated.filter(metSla);
  const breached = items.filter((item) => breachedSla(item, now));
  const byOperatorBase = breakdown(items.filter((item) => item.assignedToStaffId !== null), (item) => item.assignedToStaffId as string, now);

  return {
    total: items.length,
    open: open.length,
    inProgress: open.filter((item) => item.status === "IN_PROGRESS").length,
    completed: successful.length,
    completedToday: successful.filter((item) => {
      const completedAt = timestamp(item.completedAt as string);
      return completedAt >= startMs && completedAt < endMs;
    }).length,
    overdueOpen: open.filter((item) => breachedSla(item, now)).length,
    nearSla: open.filter((item) => {
      if (item.dueAt === null) return false;
      const remaining = timestamp(item.dueAt) - now;
      return remaining >= 0 && remaining <= NEAR_SLA_WINDOW_MS;
    }).length,
    evaluated: evaluated.length,
    met: met.length,
    breached: breached.length,
    slaMetPercent: evaluated.length === 0 ? null : Math.round((met.length / evaluated.length) * 100),
    averageQueueWaitMinutes: average(items.filter((item) => item.assignedAt !== null).map((item) => minutes(item.createdAt, item.assignedAt as string))),
    averageTimeToStartMinutes: average(items.filter((item) => item.startedAt !== null).map((item) => minutes(item.createdAt, item.startedAt as string))),
    averageCompletionMinutes: average(successful.map((item) => minutes(item.createdAt, item.completedAt as string))),
    byStatus: breakdown(items, (item) => item.status, now),
    byType: breakdown(items, (item) => item.type, now),
    byQueue: breakdown(items, (item) => item.queueKey, now),
    byOperator: byOperatorBase.map((row) => {
      const assigned = items.filter((item) => item.assignedToStaffId === row.key);
      const durations = assigned
        .filter((item) => item.status === "COMPLETED" && item.completedAt !== null)
        .map((item) => minutes(item.createdAt, item.completedAt as string));
      return {
        ...row,
        label: assigned.find((item) => item.assignedToStaffName)?.assignedToStaffName ?? row.key,
        averageCompletionMinutes: average(durations),
      };
    }),
  };
}
