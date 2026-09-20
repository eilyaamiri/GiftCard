import { describe, expect, it, vi } from 'vitest';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { SupportChannelsService, type SupportChannelsDatabase } from './support-channels.service';

const ACTOR = {
  staff: { staffId: 'staff-1', role: 'ADMIN' },
  metadata: { ip: '127.0.0.1', userAgent: 'vitest' },
} as never;

interface Row {
  id: string;
  kind: string;
  isEnabled: boolean;
  title: string;
  description: string;
  value: string;
  sortOrder: number;
  updatedAt: Date;
  updatedByStaffId?: string | null;
}

function row(overrides: Partial<Row> & Pick<Row, 'kind'>): Row {
  return {
    id: `spch_${overrides.kind.toLowerCase()}`,
    isEnabled: false,
    title: overrides.kind,
    description: '',
    value: '',
    sortOrder: 0,
    updatedAt: new Date('2026-09-20T00:00:00.000Z'),
    ...overrides,
  };
}

function harness(rows: Row[]) {
  const record = vi.fn(async (entry: unknown) => {
    void entry;
  });
  const database = {
    supportChannel: {
      findMany: vi.fn(async (args: { where?: Record<string, unknown> }) => {
        if (args.where === undefined) return [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
        return rows
          .filter((entry) => entry.isEnabled && entry.value !== '')
          .sort((a, b) => a.sortOrder - b.sortOrder);
      }),
      findUnique: vi.fn(async (args: { where: { kind: string } }) => {
        return rows.find((entry) => entry.kind === args.where.kind) ?? null;
      }),
      update: vi.fn(async (args: { where: { kind: string }; data: Record<string, unknown> }) => {
        const index = rows.findIndex((entry) => entry.kind === args.where.kind);
        rows[index] = { ...rows[index], ...args.data } as Row;
        return rows[index];
      }),
    },
  } as unknown as SupportChannelsDatabase;

  return {
    database,
    record,
    service: new SupportChannelsService(database, { record } as never),
  };
}

describe('SupportChannelsService.listPublic', () => {
  it('hands the storefront a finished link, so nothing is assembled in a browser', async () => {
    const { service } = harness([
      row({ kind: 'WHATSAPP', isEnabled: true, value: '989121234567', sortOrder: 1, title: 'واتساپ' }),
      row({ kind: 'PHONE', isEnabled: true, value: '02191001234', sortOrder: 0, title: 'تماس تلفنی' }),
    ]);

    const { items } = await service.listPublic();

    expect(items.map((item) => item.kind)).toEqual(['PHONE', 'WHATSAPP']);
    expect(items[0]?.href).toBe('tel:02191001234');
    expect(items[0]?.isExternal).toBe(false);
    expect(items[1]?.href).toBe('https://wa.me/989121234567');
    expect(items[1]?.isExternal).toBe(true);
  });

  it('drops an enabled channel whose value was cleared', async () => {
    const { service } = harness([
      row({ kind: 'TELEGRAM', isEnabled: true, value: '' }),
      row({ kind: 'TICKET', isEnabled: true, value: '/account/support', sortOrder: 1 }),
    ]);

    const { items } = await service.listPublic();

    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe('TICKET');
    expect(items[0]?.requiresAuth).toBe(true);
  });
});

describe('SupportChannelsService.update', () => {
  it('stores the normalised value and records who changed it', async () => {
    const { service, record } = harness([row({ kind: 'TELEGRAM' })]);

    const { channel } = await service.update(
      'TELEGRAM',
      {
        isEnabled: true,
        title: 'تلگرام',
        description: 'پاسخ‌گویی تا ۲۴ ساعت',
        value: '@baratpay',
        sortOrder: 2,
      },
      ACTOR,
    );

    expect(channel.value).toBe('https://t.me/baratpay');
    expect(channel.isEnabled).toBe(true);
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0]?.[0] as unknown as {
      action: string;
      entity: string;
      before: { value: string };
      after: { value: string };
    };
    expect(entry.action).toBe('SUPPORT_CHANNEL_UPDATED');
    expect(entry.entity).toBe('SupportChannel');
    expect(entry.before.value).toBe('');
    expect(entry.after.value).toBe('https://t.me/baratpay');
  });

  it('refuses to enable a channel with an empty value', async () => {
    const { service, database } = harness([row({ kind: 'PHONE' })]);

    await expect(
      service.update(
        'PHONE',
        { isEnabled: true, title: 'تماس تلفنی', description: '', value: '  ', sortOrder: 0 },
        ACTOR,
      ),
    ).rejects.toThrow(BaratDomainException);
    expect(database.supportChannel.update).not.toHaveBeenCalled();
  });

  it('rejects a value that does not belong to the channel kind', async () => {
    const { service, database } = harness([row({ kind: 'TICKET' })]);

    await expect(
      service.update(
        'TICKET',
        { isEnabled: true, title: 'ثبت تیکت', description: '', value: 'https://evil.test', sortOrder: 0 },
        ACTOR,
      ),
    ).rejects.toThrow(BaratDomainException);
    expect(database.supportChannel.update).not.toHaveBeenCalled();
  });

  it('fails cleanly when the channel row is missing', async () => {
    const { service } = harness([]);

    await expect(
      service.update(
        'PHONE',
        { isEnabled: false, title: 'تماس تلفنی', description: '', value: '', sortOrder: 0 },
        ACTOR,
      ),
    ).rejects.toThrow(BaratDomainException);
  });
});
