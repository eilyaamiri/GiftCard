import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { FaqsService, type FaqsDatabase } from './faqs.service';

const ACTOR = {
  staff: { staffId: 'staff-1', role: 'ADMIN' },
  metadata: { ip: '127.0.0.1', userAgent: 'vitest' },
} as never;

interface Row {
  id: string;
  question: string;
  answer: string;
  isEnabled: boolean;
  sortOrder: number;
  updatedAt: Date;
  updatedByStaffId?: string | null;
}

function row(overrides: Partial<Row> & Pick<Row, 'id'>): Row {
  return {
    question: `پرسش ${overrides.id}`,
    answer: `پاسخ ${overrides.id}`,
    isEnabled: false,
    sortOrder: 0,
    updatedAt: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(initial: Row[]) {
  const rows = [...initial];
  const record = vi.fn(async (entry: unknown) => {
    void entry;
  });
  const database = {
    faq: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        const filtered = args.where === undefined ? rows : rows.filter((entry) => entry.isEnabled);
        return [...filtered].sort((a, b) => a.sortOrder - b.sortOrder);
      }),
      findUnique: vi.fn(async (args: { where: { id: string } }) => {
        return rows.find((entry) => entry.id === args.where.id) ?? null;
      }),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => {
        const created = { id: `faq_${rows.length + 1}`, updatedAt: new Date(), ...args.data } as Row;
        rows.push(created);
        return created;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        const index = rows.findIndex((entry) => entry.id === args.where.id);
        rows[index] = { ...rows[index], ...args.data } as Row;
        return rows[index];
      }),
      delete: vi.fn(async (args: { where: { id: string } }) => {
        const index = rows.findIndex((entry) => entry.id === args.where.id);
        rows.splice(index, 1);
      }),
    },
  } as unknown as FaqsDatabase;

  return {
    rows,
    record,
    service: new FaqsService(database, { record } as never),
  };
}

describe('FaqsService.listPublic', () => {
  it('only returns enabled entries, in display order', async () => {
    const { service } = harness([
      row({ id: 'faq_b', isEnabled: true, sortOrder: 1 }),
      row({ id: 'faq_a', isEnabled: true, sortOrder: 0 }),
      row({ id: 'faq_hidden', isEnabled: false, sortOrder: -1 }),
    ]);

    const { items } = await service.listPublic();

    expect(items.map((item) => item.id)).toEqual(['faq_a', 'faq_b']);
  });
});

describe('FaqsService.create', () => {
  it('creates a row and records who added it', async () => {
    const { service, record } = harness([]);

    const { faq } = await service.create(
      { question: 'چطور سفارش را پیگیری کنم؟', answer: 'از صفحه سفارش‌های من.', isEnabled: true, sortOrder: 0 },
      ACTOR,
    );

    expect(faq.question).toBe('چطور سفارش را پیگیری کنم؟');
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]?.[0] as unknown as { action: string; before: unknown };
    expect(entry.action).toBe('FAQ_CREATED');
    expect(entry.before).toBeNull();
  });
});

describe('FaqsService.update', () => {
  it('fails cleanly when the row is missing', async () => {
    const { service } = harness([]);

    await expect(
      service.update(
        'faq_missing',
        { question: 'چطور سفارش را پیگیری کنم؟', answer: 'از صفحه سفارش‌های من.', isEnabled: true, sortOrder: 0 },
        ACTOR,
      ),
    ).rejects.toThrow(BaratDomainException);
  });
});

describe('FaqsService.remove', () => {
  it('deletes the row and records the deletion', async () => {
    const { service, record, rows } = harness([row({ id: 'faq_1' })]);

    const { id } = await service.remove('faq_1', ACTOR);

    expect(id).toBe('faq_1');
    expect(rows).toHaveLength(0);
    const entry = record.mock.calls[0]?.[0] as unknown as { action: string; after: unknown };
    expect(entry.action).toBe('FAQ_DELETED');
    expect(entry.after).toBeNull();
  });

  it('fails cleanly when the row is missing', async () => {
    const { service } = harness([]);

    await expect(service.remove('faq_missing', ACTOR)).rejects.toThrow(BaratDomainException);
  });
});
