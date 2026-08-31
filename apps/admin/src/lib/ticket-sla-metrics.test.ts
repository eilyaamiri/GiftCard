import { describe, expect, it } from "vitest";

import type { SupportTicket } from "@/lib/support-tickets";
import { calculateTicketSlaMetrics } from "@/lib/ticket-sla-metrics";

const BASE = "2026-01-01T00:00:00.000Z";

function at(minutes: number): string {
  return new Date(new Date(BASE).getTime() + minutes * 60_000).toISOString();
}

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: "ticket-1",
    workItemId: "work-1",
    code: "SUP-1",
    subject: "پیگیری سفارش",
    status: "IN_PROGRESS",
    customerId: "customer-1",
    customerName: "علی رضایی",
    customerCode: "C-1",
    orderId: null,
    orderNumber: null,
    ownerStaffId: null,
    ownerStaffName: null,
    createdAt: BASE,
    firstResponseDueAt: at(30),
    nextResponseDueAt: at(30),
    firstRespondedAt: null,
    lastRespondedAt: null,
    firstResponseBreached: false,
    responseBreached: false,
    resolutionNote: null,
    messages: [],
    ownershipHistory: [],
    ...overrides,
  } as SupportTicket;
}

function message(authorType: "CUSTOMER" | "STAFF", minutes: number, authorName: string) {
  return { id: `m-${authorType}-${minutes}`, authorType, authorName, body: "…", createdAt: at(minutes) };
}

describe("calculateTicketSlaMetrics", () => {
  it("measures the first response against the 30-minute target", () => {
    const metrics = calculateTicketSlaMetrics([
      ticket({
        id: "on-time",
        messages: [message("CUSTOMER", 0, "علی"), message("STAFF", 20, "کارشناس اول")],
      }),
      ticket({
        id: "late",
        messages: [message("CUSTOMER", 0, "زهرا"), message("STAFF", 50, "کارشناس دوم")],
      }),
    ]);

    expect(metrics.firstResponseEvaluated).toBe(2);
    expect(metrics.firstResponseMet).toBe(1);
    expect(metrics.firstResponseAttainment).toBe(50);
    expect(metrics.averageFirstResponseMinutes).toBe(35);
  });

  it("measures follow-up responses against the 60-minute target and skips unanswered waits", () => {
    const metrics = calculateTicketSlaMetrics([
      ticket({
        messages: [
          message("CUSTOMER", 0, "علی"),
          message("STAFF", 10, "کارشناس اول"),
          message("CUSTOMER", 20, "علی"),
          message("STAFF", 100, "کارشناس اول"),
          message("CUSTOMER", 200, "علی"), // still waiting — not counted yet
        ],
      }),
    ]);

    expect(metrics.followUpEvaluated).toBe(1);
    expect(metrics.followUpMet).toBe(0);
    expect(metrics.averageFollowUpMinutes).toBe(80);
    expect(metrics.awaitingStaff).toBe(1);
  });

  it("starts the wait clock at the first unanswered customer message", () => {
    const metrics = calculateTicketSlaMetrics([
      ticket({
        messages: [
          message("CUSTOMER", 0, "علی"),
          message("CUSTOMER", 5, "علی"),
          message("STAFF", 25, "کارشناس اول"),
        ],
      }),
    ]);

    expect(metrics.averageFirstResponseMinutes).toBe(25);
    expect(metrics.firstResponseMet).toBe(1);
  });

  it("attributes replies and ownership takeovers per operator", () => {
    const metrics = calculateTicketSlaMetrics([
      ticket({
        ownerStaffId: "staff-2",
        ownerStaffName: "کارشناس دوم",
        messages: [
          message("CUSTOMER", 0, "علی"),
          message("STAFF", 10, "کارشناس اول"),
          message("CUSTOMER", 30, "علی"),
          message("STAFF", 45, "کارشناس دوم"),
        ],
        ownershipHistory: [
          { id: "o1", previousOwnerName: null, newOwnerName: "کارشناس اول", changedByName: "کارشناس اول", reason: "FIRST_STAFF_REPLY", createdAt: at(10) },
          { id: "o2", previousOwnerName: "کارشناس اول", newOwnerName: "کارشناس دوم", changedByName: "کارشناس دوم", reason: "STAFF_REPLY_TAKEOVER", createdAt: at(45) },
        ],
      }),
    ]);

    expect(metrics.ownerHandoffs).toBe(1);
    const first = metrics.byOperator.find((row) => row.label === "کارشناس اول");
    const second = metrics.byOperator.find((row) => row.label === "کارشناس دوم");
    expect(first).toMatchObject({ replies: 1, firstResponses: 1, firstResponsesMet: 1, takeovers: 0 });
    expect(second).toMatchObject({ replies: 1, followUps: 1, followUpsMet: 1, takeovers: 1, ownedOpen: 1 });
  });

  it("counts open breaches but leaves closed tickets out of the open counters", () => {
    const metrics = calculateTicketSlaMetrics([
      ticket({ id: "open", responseBreached: true }),
      ticket({ id: "closed", status: "COMPLETED", responseBreached: true, resolutionNote: "حل شد" }),
    ]);

    expect(metrics.open).toBe(1);
    expect(metrics.closed).toBe(1);
    expect(metrics.overdueNow).toBe(1);
  });
});
