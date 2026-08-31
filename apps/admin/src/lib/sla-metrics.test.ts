import { describe, expect, it } from "vitest";
import type { QueueKey, WorkItemStatus, WorkItemType } from "@barat/contracts";
import { calculateSlaMetrics, type SlaMetricItem } from "./sla-metrics";

const NOW = new Date("2026-08-31T12:00:00.000Z").getTime();

function item(overrides: Partial<SlaMetricItem> = {}): SlaMetricItem {
  return {
    status: "ASSIGNED" as WorkItemStatus,
    type: "MANUAL_GIFT_CARD_FULFILLMENT" as WorkItemType,
    queueKey: "GIFT_CARD_MANUAL" as QueueKey,
    assignedToStaffId: "staff-1",
    assignedToStaffName: "اپراتور آزمون",
    createdAt: "2026-08-31T09:00:00.000Z",
    assignedAt: "2026-08-31T09:10:00.000Z",
    startedAt: null,
    completedAt: null,
    dueAt: "2026-08-31T13:00:00.000Z",
    slaBreachedAt: null,
    ...overrides,
  };
}

describe("calculateSlaMetrics", () => {
  it("keeps items without a deadline out of SLA evaluation", () => {
    const metrics = calculateSlaMetrics([item({ dueAt: null })], NOW);
    expect(metrics.evaluated).toBe(0);
    expect(metrics.slaMetPercent).toBeNull();
    expect(metrics.overdueOpen).toBe(0);
  });

  it("counts open overdue and near-SLA items separately", () => {
    const metrics = calculateSlaMetrics([
      item({ dueAt: "2026-08-31T11:59:00.000Z" }),
      item({ dueAt: "2026-08-31T12:20:00.000Z" }),
    ], NOW);
    expect(metrics.overdueOpen).toBe(1);
    expect(metrics.nearSla).toBe(1);
    expect(metrics.breached).toBe(1);
  });

  it("distinguishes completed before and after deadline", () => {
    const metrics = calculateSlaMetrics([
      item({ status: "COMPLETED", completedAt: "2026-08-31T11:00:00.000Z", dueAt: "2026-08-31T12:00:00.000Z" }),
      item({ status: "COMPLETED", completedAt: "2026-08-31T12:01:00.000Z", dueAt: "2026-08-31T12:00:00.000Z" }),
    ], NOW);
    expect(metrics.evaluated).toBe(2);
    expect(metrics.met).toBe(1);
    expect(metrics.breached).toBe(1);
    expect(metrics.slaMetPercent).toBe(50);
  });

  it("does not treat a failed terminal item as meeting SLA", () => {
    const metrics = calculateSlaMetrics([
      item({ status: "FAILED", completedAt: "2026-08-31T11:00:00.000Z", dueAt: "2026-08-31T12:00:00.000Z" }),
    ], NOW);
    expect(metrics.met).toBe(0);
    expect(metrics.breached).toBe(1);
  });

  it("uses the authoritative breach marker when present", () => {
    const metrics = calculateSlaMetrics([
      item({ status: "COMPLETED", completedAt: "2026-08-31T11:00:00.000Z", dueAt: "2026-08-31T12:00:00.000Z", slaBreachedAt: "2026-08-31T10:30:00.000Z" }),
    ], NOW);
    expect(metrics.met).toBe(1);
    expect(metrics.breached).toBe(1);
  });

  it("calculates queue, start and completion durations", () => {
    const metrics = calculateSlaMetrics([
      item({ status: "COMPLETED", startedAt: "2026-08-31T09:30:00.000Z", completedAt: "2026-08-31T10:30:00.000Z" }),
    ], NOW);
    expect(metrics.averageQueueWaitMinutes).toBe(10);
    expect(metrics.averageTimeToStartMinutes).toBe(30);
    expect(metrics.averageCompletionMinutes).toBe(90);
    expect(metrics.completedToday).toBe(1);
  });

  it("returns null averages for an empty report", () => {
    const metrics = calculateSlaMetrics([], NOW);
    expect(metrics.total).toBe(0);
    expect(metrics.averageQueueWaitMinutes).toBeNull();
    expect(metrics.averageTimeToStartMinutes).toBeNull();
    expect(metrics.averageCompletionMinutes).toBeNull();
  });
});
