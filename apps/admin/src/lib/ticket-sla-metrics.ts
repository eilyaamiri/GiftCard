import type { SupportTicket } from "@/lib/support-tickets";

/** Mirrors the API-side SLA windows in `support.service.ts`. */
export const FIRST_RESPONSE_SLA_MINUTES = 30;
export const NEXT_RESPONSE_SLA_MINUTES = 60;

const CLOSED_STATUSES = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export interface TicketOperatorRow {
  readonly key: string;
  readonly label: string;
  readonly replies: number;
  readonly ownedOpen: number;
  readonly firstResponses: number;
  readonly firstResponsesMet: number;
  readonly followUps: number;
  readonly followUpsMet: number;
  readonly averageResponseMinutes: number | null;
  readonly takeovers: number;
}

export interface TicketSlaMetrics {
  readonly total: number;
  readonly open: number;
  readonly closed: number;
  readonly awaitingStaff: number;
  readonly unassigned: number;
  readonly overdueNow: number;
  readonly firstResponseEvaluated: number;
  readonly firstResponseMet: number;
  readonly firstResponseAttainment: number | null;
  readonly averageFirstResponseMinutes: number | null;
  readonly followUpEvaluated: number;
  readonly followUpMet: number;
  readonly followUpAttainment: number | null;
  readonly averageFollowUpMinutes: number | null;
  readonly ownerHandoffs: number;
  readonly byOperator: readonly TicketOperatorRow[];
}

interface ResponsePair {
  readonly staffName: string;
  readonly minutes: number;
  readonly isFirst: boolean;
  readonly met: boolean;
}

function timestamp(value: string): number {
  return new Date(value).getTime();
}

function minutesBetween(startMs: number, endMs: number): number {
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

function average(values: readonly number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percent(met: number, evaluated: number): number | null {
  return evaluated === 0 ? null : Math.round((met / evaluated) * 100);
}

function isClosed(ticket: SupportTicket): boolean {
  return CLOSED_STATUSES.has(ticket.status);
}

/**
 * Walks a thread and pairs every customer message with the staff reply that
 * answered it. Consecutive customer messages count as one wait — the clock
 * starts at the first unanswered one, which is what the customer experiences.
 */
function responsePairs(ticket: SupportTicket): ResponsePair[] {
  const pairs: ResponsePair[] = [];
  let waitingSince: number | null = null;
  let seenStaffReply = false;

  for (const message of ticket.messages) {
    const at = timestamp(message.createdAt);
    if (message.authorType === "CUSTOMER") {
      waitingSince ??= at;
      continue;
    }
    if (waitingSince !== null) {
      const elapsed = minutesBetween(waitingSince, at);
      const target = seenStaffReply ? NEXT_RESPONSE_SLA_MINUTES : FIRST_RESPONSE_SLA_MINUTES;
      pairs.push({ staffName: message.authorName, minutes: elapsed, isFirst: !seenStaffReply, met: elapsed <= target });
      waitingSince = null;
    }
    seenStaffReply = true;
  }
  return pairs;
}

export function calculateTicketSlaMetrics(tickets: readonly SupportTicket[]): TicketSlaMetrics {
  const open = tickets.filter((ticket) => !isClosed(ticket));
  const pairsByTicket = tickets.map(responsePairs);
  const allPairs = pairsByTicket.flat();
  const firstPairs = allPairs.filter((pair) => pair.isFirst);
  const followUpPairs = allPairs.filter((pair) => !pair.isFirst);

  const operators = new Map<string, {
    replies: number; ownedOpen: number; firstResponses: number; firstResponsesMet: number;
    followUps: number; followUpsMet: number; durations: number[]; takeovers: number;
  }>();
  const operatorRow = (name: string) => {
    const existing = operators.get(name);
    if (existing) return existing;
    const created = { replies: 0, ownedOpen: 0, firstResponses: 0, firstResponsesMet: 0, followUps: 0, followUpsMet: 0, durations: [] as number[], takeovers: 0 };
    operators.set(name, created);
    return created;
  };

  let ownerHandoffs = 0;
  for (const [index, ticket] of tickets.entries()) {
    for (const message of ticket.messages) {
      if (message.authorType === "STAFF") operatorRow(message.authorName).replies += 1;
    }
    for (const event of ticket.ownershipHistory) {
      if (event.reason === "STAFF_REPLY_TAKEOVER") {
        ownerHandoffs += 1;
        operatorRow(event.newOwnerName).takeovers += 1;
      }
    }
    if (!isClosed(ticket) && ticket.ownerStaffName) operatorRow(ticket.ownerStaffName).ownedOpen += 1;
    for (const pair of pairsByTicket[index] ?? []) {
      const row = operatorRow(pair.staffName);
      row.durations.push(pair.minutes);
      if (pair.isFirst) {
        row.firstResponses += 1;
        if (pair.met) row.firstResponsesMet += 1;
      } else {
        row.followUps += 1;
        if (pair.met) row.followUpsMet += 1;
      }
    }
  }

  return {
    total: tickets.length,
    open: open.length,
    closed: tickets.length - open.length,
    awaitingStaff: open.filter((ticket) => ticket.messages.at(-1)?.authorType === "CUSTOMER").length,
    unassigned: open.filter((ticket) => ticket.ownerStaffId === null).length,
    overdueNow: open.filter((ticket) => ticket.responseBreached || (ticket.firstRespondedAt === null && ticket.firstResponseBreached)).length,
    firstResponseEvaluated: firstPairs.length,
    firstResponseMet: firstPairs.filter((pair) => pair.met).length,
    firstResponseAttainment: percent(firstPairs.filter((pair) => pair.met).length, firstPairs.length),
    averageFirstResponseMinutes: average(firstPairs.map((pair) => pair.minutes)),
    followUpEvaluated: followUpPairs.length,
    followUpMet: followUpPairs.filter((pair) => pair.met).length,
    followUpAttainment: percent(followUpPairs.filter((pair) => pair.met).length, followUpPairs.length),
    averageFollowUpMinutes: average(followUpPairs.map((pair) => pair.minutes)),
    ownerHandoffs,
    byOperator: [...operators.entries()]
      .map(([label, row]) => ({
        key: label,
        label,
        replies: row.replies,
        ownedOpen: row.ownedOpen,
        firstResponses: row.firstResponses,
        firstResponsesMet: row.firstResponsesMet,
        followUps: row.followUps,
        followUpsMet: row.followUpsMet,
        averageResponseMinutes: average(row.durations),
        takeovers: row.takeovers,
      }))
      .sort((a, b) => b.replies - a.replies || a.label.localeCompare(b.label)),
  };
}
