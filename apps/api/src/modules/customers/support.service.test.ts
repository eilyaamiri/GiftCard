import { describe, expect, it, vi } from 'vitest';

import type { AuthenticatedStaff } from '../identity/identity.tokens';
import type { CustomersDatabase } from './customers.tokens';
import { SupportService } from './support.service';

function ticketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ticket-1',
    workItemId: 'work-1',
    ownerStaffId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    firstResponseDueAt: new Date('2026-01-01T00:30:00.000Z'),
    nextResponseDueAt: new Date('2026-01-01T00:30:00.000Z'),
    firstRespondedAt: null,
    lastRespondedAt: null,
    closedAt: null,
    workItem: {
      code: 'SUP-ABCDE',
      title: 'پیگیری سفارش',
      status: 'UNASSIGNED',
      customerId: 'customer-a',
      orderId: null,
      resolutionNote: null,
      customer: { customerCode: 'C-1', profile: { firstName: 'علی', lastName: 'رضایی' } },
      order: null,
    },
    owner: null,
    messages: [],
    ownershipEvents: [],
    ...overrides,
  };
}

function staff(staffId: string): AuthenticatedStaff {
  return { type: 'STAFF', staffId, role: 'OPERATOR', email: `${staffId}@example.com` } as AuthenticatedStaff;
}

/** Captures the writes a `$transaction` callback performs against fake delegates. */
function transactionRecorder(finalRow: ReturnType<typeof ticketRow>) {
  const calls = {
    message: [] as Record<string, unknown>[],
    ownership: [] as Record<string, unknown>[],
    ticketUpdate: [] as Record<string, unknown>[],
    workItemUpdate: [] as Record<string, unknown>[],
  };
  const tx = {
    supportMessage: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { calls.message.push(data); }) },
    supportOwnershipEvent: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { calls.ownership.push(data); }) },
    supportTicket: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { calls.ticketUpdate.push(data); }),
      findUniqueOrThrow: vi.fn(async () => finalRow),
    },
    workItem: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { calls.workItemUpdate.push(data); }) },
  };
  return { calls, run: vi.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)) };
}

describe('SupportService ticket ownership', () => {
  it('makes the first replying staff member the owner and records the transition', async () => {
    const recorder = transactionRecorder(ticketRow({ ownerStaffId: 'staff-1' }));
    const database = {
      supportTicket: {
        findUnique: vi.fn(async () => ({ id: 'ticket-1', workItemId: 'work-1', ownerStaffId: null, firstRespondedAt: null, closedAt: null })),
      },
      $transaction: recorder.run,
    } as unknown as CustomersDatabase;
    const service = new SupportService(database, { record: vi.fn() } as never);

    const dto = await service.replyAsStaff(staff('staff-1'), 'ticket-1', { message: 'در حال بررسی است.' });

    expect(dto.ownerStaffId).toBe('staff-1');
    expect(recorder.calls.ownership).toEqual([
      expect.objectContaining({ previousStaffId: null, newStaffId: 'staff-1', changedByStaffId: 'staff-1', reason: 'FIRST_STAFF_REPLY' }),
    ]);
    expect(recorder.calls.ticketUpdate[0]).toMatchObject({ ownerStaffId: 'staff-1' });
    expect(recorder.calls.ticketUpdate[0]?.firstRespondedAt).toBeInstanceOf(Date);
  });

  it('transfers ownership to a second staff member who replies mid-thread', async () => {
    const recorder = transactionRecorder(ticketRow({ ownerStaffId: 'staff-2' }));
    const database = {
      supportTicket: {
        findUnique: vi.fn(async () => ({
          id: 'ticket-1',
          workItemId: 'work-1',
          ownerStaffId: 'staff-1',
          firstRespondedAt: new Date('2026-01-01T00:10:00.000Z'),
          closedAt: null,
        })),
      },
      $transaction: recorder.run,
    } as unknown as CustomersDatabase;
    const service = new SupportService(database, { record: vi.fn() } as never);

    await service.replyAsStaff(staff('staff-2'), 'ticket-1', { message: 'پاسخ تکمیلی.' });

    expect(recorder.calls.ownership).toEqual([
      expect.objectContaining({ previousStaffId: 'staff-1', newStaffId: 'staff-2', reason: 'STAFF_REPLY_TAKEOVER' }),
    ]);
    // The original first-response timestamp must survive the handover, otherwise
    // the takeover would silently reset the ticket's first-response SLA.
    expect(recorder.calls.ticketUpdate[0]?.firstRespondedAt).toEqual(new Date('2026-01-01T00:10:00.000Z'));
  });

  it('does not record an ownership event when the current owner replies again', async () => {
    const recorder = transactionRecorder(ticketRow({ ownerStaffId: 'staff-1' }));
    const database = {
      supportTicket: {
        findUnique: vi.fn(async () => ({
          id: 'ticket-1',
          workItemId: 'work-1',
          ownerStaffId: 'staff-1',
          firstRespondedAt: new Date('2026-01-01T00:10:00.000Z'),
          closedAt: null,
        })),
      },
      $transaction: recorder.run,
    } as unknown as CustomersDatabase;
    const service = new SupportService(database, { record: vi.fn() } as never);

    await service.replyAsStaff(staff('staff-1'), 'ticket-1', { message: 'پیگیری شد.' });

    expect(recorder.calls.ownership).toEqual([]);
  });

  it('exposes the ownership history on the ticket DTO', async () => {
    const row = ticketRow({
      ownerStaffId: 'staff-2',
      owner: { id: 'staff-2', fullName: 'کارشناس دوم' },
      ownershipEvents: [
        {
          id: 'own-1',
          previousStaff: null,
          newStaff: { fullName: 'کارشناس اول' },
          changedBy: { fullName: 'کارشناس اول' },
          reason: 'FIRST_STAFF_REPLY',
          createdAt: new Date('2026-01-01T00:10:00.000Z'),
        },
        {
          id: 'own-2',
          previousStaff: { fullName: 'کارشناس اول' },
          newStaff: { fullName: 'کارشناس دوم' },
          changedBy: { fullName: 'کارشناس دوم' },
          reason: 'STAFF_REPLY_TAKEOVER',
          createdAt: new Date('2026-01-01T01:00:00.000Z'),
        },
      ],
    });
    const database = { supportTicket: { findUnique: vi.fn(async () => row) } } as unknown as CustomersDatabase;
    const service = new SupportService(database, { record: vi.fn() } as never);

    const dto = await service.getForStaff('ticket-1');

    expect(dto.ownershipHistory.map((event) => event.reason)).toEqual(['FIRST_STAFF_REPLY', 'STAFF_REPLY_TAKEOVER']);
    expect(dto.ownershipHistory[1]).toMatchObject({ previousOwnerName: 'کارشناس اول', newOwnerName: 'کارشناس دوم' });
  });
});

describe('SupportService customer scoping', () => {
  it('answers 404 when a customer asks for another customer ticket', async () => {
    const findFirst = vi.fn(async ({ where }: { where: { id: string; workItem: { customerId: string } } }) =>
      where.workItem.customerId === 'customer-b' ? ticketRow() : null,
    );
    const database = { supportTicket: { findFirst } } as unknown as CustomersDatabase;
    const service = new SupportService(database, { record: vi.fn() } as never);

    await expect(service.getForCustomer('customer-a', 'ticket-1')).rejects.toMatchObject({ status: 404 });
    // The ownership predicate must be part of the query, not an afterthought.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'ticket-1', workItem: { customerId: 'customer-a' } } }),
    );
  });
});

describe('SupportService SLA flags', () => {
  it('flags a first-response breach only once the deadline has passed unanswered', async () => {
    const answeredLate = ticketRow({
      firstRespondedAt: new Date('2026-01-01T00:45:00.000Z'),
      lastRespondedAt: new Date('2026-01-01T00:45:00.000Z'),
      workItem: { ...ticketRow().workItem, status: 'WAITING_CUSTOMER' },
    });
    const answeredOnTime = ticketRow({
      firstRespondedAt: new Date('2026-01-01T00:29:00.000Z'),
      lastRespondedAt: new Date('2026-01-01T00:29:00.000Z'),
      nextResponseDueAt: new Date('2100-01-01T00:00:00.000Z'),
      workItem: { ...ticketRow().workItem, status: 'WAITING_CUSTOMER' },
    });
    const service = (row: ReturnType<typeof ticketRow>) =>
      new SupportService(
        { supportTicket: { findUnique: vi.fn(async () => row) } } as unknown as CustomersDatabase,
        { record: vi.fn() } as never,
      );

    await expect(service(answeredLate).getForStaff('ticket-1')).resolves.toMatchObject({ firstResponseBreached: true });
    await expect(service(answeredOnTime).getForStaff('ticket-1')).resolves.toMatchObject({
      firstResponseBreached: false,
      responseBreached: false,
    });
  });

  it('flags an open ticket past its next-response deadline as breached', async () => {
    const row = ticketRow({
      firstRespondedAt: new Date('2026-01-01T00:10:00.000Z'),
      nextResponseDueAt: new Date('2026-01-01T01:10:00.000Z'),
      workItem: { ...ticketRow().workItem, status: 'IN_PROGRESS' },
    });
    const service = new SupportService(
      { supportTicket: { findUnique: vi.fn(async () => row) } } as unknown as CustomersDatabase,
      { record: vi.fn() } as never,
    );

    await expect(service.getForStaff('ticket-1')).resolves.toMatchObject({ responseBreached: true });
  });
});
