import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@barat/database';

import { WORK_ITEM_TERMINAL_STATUSES } from './workitems.types';

export const STAFF_NOTIFICATIONS_DATABASE = Symbol('STAFF_NOTIFICATIONS_DATABASE');

/**
 * Read-only, and narrow on purpose. A notification feed observes work; it never
 * claims, assigns or completes anything.
 */
export type StaffNotificationsDatabase = Pick<
  PrismaClient,
  'workItem' | 'queueMembership' | 'supportMessage'
>;

export type StaffNotificationKind =
  | 'TASK_ASSIGNED'
  | 'TASK_SLA_BREACHED'
  | 'TASK_DUE_SOON'
  | 'QUEUE_TASK_WAITING'
  | 'SUPPORT_CUSTOMER_REPLY';

export interface StaffNotificationDto {
  /** Derived from the row and the event, never generated. See the customer feed. */
  readonly id: string;
  readonly kind: StaffNotificationKind;
  readonly title: string;
  readonly body: string | null;
  readonly href: string | null;
  readonly createdAt: string;
}

export interface StaffNotificationFeed {
  readonly items: readonly StaffNotificationDto[];
  readonly generatedAt: string;
}

/**
 * The staff notification feed, derived on read from work that is already on
 * record. Same trade as the customer feed in `customers/notifications.service`:
 * no `Notification` table, so nothing can drift from the work item it describes,
 * and "read" is a client-side marker against `generatedAt`.
 *
 * Scope is what the caller is responsible for, not what they are allowed to see:
 * their own assigned tasks, the unassigned work in queues they are a member of,
 * and customer replies on tickets they own. An administrator who holds no tasks
 * therefore has an empty feed, which is correct — the bell is a work queue, not
 * an activity log of the whole shop.
 *
 * Nothing here reads `payload`, `resolutionNote` or any fulfilment detail, so a
 * supplier response, code or PIN cannot reach this surface.
 */
@Injectable()
export class StaffNotificationsService {
  constructor(
    @Inject(STAFF_NOTIFICATIONS_DATABASE)
    private readonly database: StaffNotificationsDatabase,
  ) {}

  async list(staffId: string, now: Date = new Date()): Promise<StaffNotificationFeed> {
    const memberships = await this.database.queueMembership.findMany({
      where: { staffUserId: staffId },
      select: { queueId: true },
    });
    const queueIds = memberships.map((membership) => membership.queueId);

    const [assigned, waiting, replies] = await Promise.all([
      this.database.workItem.findMany({
        where: { assignedToStaffId: staffId, status: { notIn: [...WORK_ITEM_TERMINAL_STATUSES] } },
        orderBy: { assignedAt: 'desc' },
        take: SOURCE_LIMIT,
        select: {
          id: true,
          code: true,
          title: true,
          assignedAt: true,
          dueAt: true,
          slaBreachedAt: true,
          createdAt: true,
        },
      }),
      queueIds.length === 0
        ? []
        : this.database.workItem.findMany({
            where: { status: 'UNASSIGNED', queueId: { in: queueIds } },
            orderBy: { createdAt: 'desc' },
            take: SOURCE_LIMIT,
            select: { id: true, code: true, title: true, createdAt: true },
          }),
      this.database.supportMessage.findMany({
        where: { authorType: 'CUSTOMER', ticket: { ownerStaffId: staffId, closedAt: null } },
        orderBy: { createdAt: 'desc' },
        take: SOURCE_LIMIT,
        select: {
          id: true,
          createdAt: true,
          ticket: { select: { id: true, workItem: { select: { code: true, title: true } } } },
        },
      }),
    ]);

    const items = [
      ...assigned.flatMap((item) => assignedEvents(item, now)),
      ...waiting.map(queueWaitingEvent),
      ...replies.map(supportReplyEvent),
    ]
      .sort(newestFirst)
      .slice(0, FEED_LIMIT);

    return { items, generatedAt: now.toISOString() };
  }
}

const SOURCE_LIMIT = 20;
const FEED_LIMIT = 20;
/** How close a deadline has to be before it is worth interrupting an operator. */
const DUE_SOON_MS = 60 * 60 * 1000;

interface AssignedWorkItemRow {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly assignedAt: Date | null;
  readonly dueAt: Date | null;
  readonly slaBreachedAt: Date | null;
  readonly createdAt: Date;
}

interface QueueWorkItemRow {
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly createdAt: Date;
}

interface SupportReplyRow {
  readonly id: string;
  readonly createdAt: Date;
  readonly ticket: {
    readonly id: string;
    readonly workItem: { readonly code: string; readonly title: string };
  };
}

/**
 * A breached deadline and an approaching one are mutually exclusive: once the
 * SLA is gone, "due soon" is no longer true and repeating the same task twice in
 * the list would only bury the other work.
 */
function assignedEvents(item: AssignedWorkItemRow, now: Date): readonly StaffNotificationDto[] {
  const href = `/operator/tasks/${item.id}`;
  const events: StaffNotificationDto[] = [
    line(
      `task:${item.id}:assigned`,
      'TASK_ASSIGNED',
      `تسک ${item.code} به شما ارجاع شد`,
      item.title,
      href,
      item.assignedAt ?? item.createdAt,
    ),
  ];

  if (item.slaBreachedAt !== null) {
    events.push(
      line(
        `task:${item.id}:sla`,
        'TASK_SLA_BREACHED',
        `مهلت تسک ${item.code} گذشته است`,
        item.title,
        href,
        item.slaBreachedAt,
      ),
    );
  } else if (item.dueAt !== null && isDueSoon(item.dueAt, now)) {
    events.push(
      line(
        `task:${item.id}:due-soon`,
        'TASK_DUE_SOON',
        `مهلت تسک ${item.code} نزدیک است`,
        item.title,
        href,
        /* Dated by the point at which the warning became relevant. This is
         * stable between polls and never lies in the future, so opening the bell
         * can advance its timestamp-based read marker past this line. */
        new Date(item.dueAt.getTime() - DUE_SOON_MS),
      ),
    );
  }

  return events;
}

function isDueSoon(dueAt: Date, now: Date): boolean {
  const remaining = dueAt.getTime() - now.getTime();
  return remaining > 0 && remaining <= DUE_SOON_MS;
}

function queueWaitingEvent(item: QueueWorkItemRow): StaffNotificationDto {
  return line(
    `queue:${item.id}`,
    'QUEUE_TASK_WAITING',
    `تسک ${item.code} در صف شما منتظر پذیرش است`,
    item.title,
    `/operator/tasks/${item.id}`,
    item.createdAt,
  );
}

/** The ticket subject travels, the message body does not. */
function supportReplyEvent(reply: SupportReplyRow): StaffNotificationDto {
  return line(
    `support:${reply.id}`,
    'SUPPORT_CUSTOMER_REPLY',
    `پاسخ جدید مشتری در تیکت ${reply.ticket.workItem.code}`,
    reply.ticket.workItem.title,
    `/operator/support/${reply.ticket.id}`,
    reply.createdAt,
  );
}

function line(
  id: string,
  kind: StaffNotificationKind,
  title: string,
  body: string | null,
  href: string | null,
  at: Date,
): StaffNotificationDto {
  return { id, kind, title, body, href, createdAt: at.toISOString() };
}

function newestFirst(left: StaffNotificationDto, right: StaffNotificationDto): number {
  if (left.createdAt !== right.createdAt) {
    return left.createdAt < right.createdAt ? 1 : -1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
