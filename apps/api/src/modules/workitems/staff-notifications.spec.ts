import { describe, expect, it, vi } from 'vitest';

import {
  StaffNotificationsService,
  type StaffNotificationsDatabase,
} from './staff-notifications.service';

const NOW = new Date('2026-09-10T12:00:00.000Z');

interface Seed {
  readonly memberships?: readonly { readonly queueId: string }[];
  readonly assigned?: readonly Record<string, unknown>[];
  readonly waiting?: readonly Record<string, unknown>[];
  readonly replies?: readonly Record<string, unknown>[];
}

interface Rig {
  readonly service: StaffNotificationsService;
  readonly workItemArgs: Record<string, unknown>[];
  readonly replyArgs: Record<string, unknown>[];
}

function buildRig(seed: Seed = {}): Rig {
  const workItemArgs: Record<string, unknown>[] = [];
  const replyArgs: Record<string, unknown>[] = [];

  const database = {
    queueMembership: { findMany: vi.fn(async () => seed.memberships ?? []) },
    workItem: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        workItemArgs.push(args);
        const where = args['where'] as Record<string, unknown>;
        return where['status'] === 'UNASSIGNED' ? (seed.waiting ?? []) : (seed.assigned ?? []);
      }),
    },
    supportMessage: {
      findMany: vi.fn(async (args: Record<string, unknown>) => {
        replyArgs.push(args);
        return seed.replies ?? [];
      }),
    },
  } as unknown as StaffNotificationsDatabase;

  return { service: new StaffNotificationsService(database), workItemArgs, replyArgs };
}

function task(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'wi-1',
    code: 'WI-1001',
    title: 'تحویل دستی گیفت‌کارت',
    assignedAt: new Date('2026-09-10T09:00:00.000Z'),
    dueAt: null,
    slaBreachedAt: null,
    createdAt: new Date('2026-09-10T08:00:00.000Z'),
    ...overrides,
  };
}

describe('StaffNotificationsService / scoping', () => {
  it('reads only the caller’s own open tasks', async () => {
    const rig = buildRig();

    await rig.service.list('staff-3', NOW);

    expect(rig.workItemArgs[0]?.['where']).toEqual({
      assignedToStaffId: 'staff-3',
      status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] },
    });
  });

  it('skips the queue query entirely for staff who belong to no queue', async () => {
    const rig = buildRig({ memberships: [] });

    const feed = await rig.service.list('staff-3', NOW);

    expect(rig.workItemArgs).toHaveLength(1);
    expect(feed.items).toEqual([]);
  });

  it('offers unassigned work only from queues the caller is a member of', async () => {
    const rig = buildRig({
      memberships: [{ queueId: 'queue-a' }, { queueId: 'queue-b' }],
      waiting: [{ id: 'wi-9', code: 'WI-9', title: 'پرداخت بین‌المللی', createdAt: NOW }],
    });

    const feed = await rig.service.list('staff-3', NOW);

    expect(rig.workItemArgs[1]?.['where']).toEqual({
      status: 'UNASSIGNED',
      queueId: { in: ['queue-a', 'queue-b'] },
    });
    expect(feed.items[0]).toMatchObject({
      id: 'queue:wi-9',
      kind: 'QUEUE_TASK_WAITING',
      href: '/operator/tasks/wi-9',
    });
  });

  it('reads customer replies only on open tickets the caller owns', async () => {
    const rig = buildRig();

    await rig.service.list('staff-3', NOW);

    expect(rig.replyArgs[0]?.['where']).toEqual({
      authorType: 'CUSTOMER',
      ticket: { ownerStaffId: 'staff-3', closedAt: null },
    });
    expect(rig.replyArgs[0]?.['select']).not.toHaveProperty('body');
  });
});

describe('StaffNotificationsService / deadlines', () => {
  it('warns once a deadline is inside the hour, dated by when the warning began', async () => {
    const rig = buildRig({
      assigned: [task({ dueAt: new Date('2026-09-10T12:45:00.000Z') })],
    });

    const feed = await rig.service.list('staff-3', NOW);

    expect(feed.items.map((item) => item.kind)).toEqual(['TASK_DUE_SOON', 'TASK_ASSIGNED']);
    expect(feed.items[0]).toMatchObject({
      id: 'task:wi-1:due-soon',
      createdAt: '2026-09-10T11:45:00.000Z',
    });
  });

  it('says nothing about a deadline that is still hours away', async () => {
    const rig = buildRig({
      assigned: [task({ dueAt: new Date('2026-09-10T18:00:00.000Z') })],
    });

    const feed = await rig.service.list('staff-3', NOW);

    expect(feed.items.map((item) => item.kind)).toEqual(['TASK_ASSIGNED']);
  });

  it('replaces the warning with a breach once the deadline is gone', async () => {
    const rig = buildRig({
      assigned: [
        task({
          dueAt: new Date('2026-09-10T11:30:00.000Z'),
          slaBreachedAt: new Date('2026-09-10T11:30:00.000Z'),
        }),
      ],
    });

    const feed = await rig.service.list('staff-3', NOW);

    expect(feed.items.map((item) => item.kind)).toEqual(['TASK_SLA_BREACHED', 'TASK_ASSIGNED']);
    expect(feed.items[0]?.title).toBe('مهلت تسک WI-1001 گذشته است');
  });
});

describe('StaffNotificationsService / feed', () => {
  it('falls back to the creation time for a task with no assignment stamp', async () => {
    const rig = buildRig({ assigned: [task({ assignedAt: null })] });

    const feed = await rig.service.list('staff-3', NOW);

    expect(feed.items[0]).toMatchObject({
      id: 'task:wi-1:assigned',
      createdAt: '2026-09-10T08:00:00.000Z',
    });
  });

  it('sorts every source into one list, newest first', async () => {
    const rig = buildRig({
      memberships: [{ queueId: 'queue-a' }],
      assigned: [task()],
      waiting: [
        {
          id: 'wi-9',
          code: 'WI-9',
          title: 'پرداخت بین‌المللی',
          createdAt: new Date('2026-09-10T10:00:00.000Z'),
        },
      ],
      replies: [
        {
          id: 'message-4',
          createdAt: new Date('2026-09-10T11:00:00.000Z'),
          ticket: { id: 'ticket-2', workItem: { code: 'WI-500', title: 'پیگیری سفارش' } },
        },
      ],
    });

    const feed = await rig.service.list('staff-3', NOW);

    expect(feed.items.map((item) => item.id)).toEqual([
      'support:message-4',
      'queue:wi-9',
      'task:wi-1:assigned',
    ]);
    expect(feed.items[0]).toMatchObject({
      kind: 'SUPPORT_CUSTOMER_REPLY',
      title: 'پاسخ جدید مشتری در تیکت WI-500',
      body: 'پیگیری سفارش',
      href: '/operator/support/ticket-2',
    });
    expect(feed.generatedAt).toBe(NOW.toISOString());
  });
});
