import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';

import type { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff } from './identity.tokens';
import {
  AdminSettingsService,
  type AdminSettingsDatabase,
} from './admin-settings.service';

const NOW = new Date('2026-09-08T10:00:00.000Z');
const ADMIN: AuthenticatedStaff = {
  type: 'STAFF',
  staffId: 'admin-1',
  email: 'admin@barat.test',
  role: 'ADMIN',
};
const ACTOR = {
  staff: ADMIN,
  metadata: { ip: '203.0.113.4', userAgent: 'vitest' },
};

interface StaffRow {
  id: string;
  email: string;
  fullName: string;
  role: 'ADMIN' | 'MANAGEMENT' | 'OPS_MANAGER' | 'OPERATOR' | 'FINANCE' | 'SUPPORT' | 'VIEWER';
  isActive: boolean;
  passwordHash: string;
  lastLoginAt: Date | null;
  createdAt: Date;
  queueMemberships: Array<{
    queue: { id: string; key: string; name: string };
  }>;
}

interface QueueMember {
  canAssign: boolean;
  staffUser: Pick<StaffRow, 'id' | 'email' | 'fullName' | 'role' | 'isActive'>;
}

interface QueueRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isActive: boolean;
  slaMinutes: number | null;
  updatedAt: Date;
  memberships: QueueMember[];
  _count: { workItems: number };
}

function staffRow(input: Partial<StaffRow> & Pick<StaffRow, 'id' | 'role'>): StaffRow {
  return {
    email: `${input.id}@barat.test`,
    fullName: input.id,
    isActive: true,
    passwordHash: '$argon2id$existing',
    lastLoginAt: null,
    createdAt: NOW,
    queueMemberships: [],
    ...input,
  };
}

function buildRig(options?: {
  staff?: StaffRow[];
  queues?: QueueRow[];
  deleteErrorCode?: string;
}) {
  const staff =
    options?.staff ??
    [
      staffRow({ id: 'admin-1', role: 'ADMIN' }),
      staffRow({ id: 'admin-2', role: 'ADMIN' }),
      staffRow({ id: 'operator-1', role: 'OPERATOR' }),
    ];
  const flags = [
    {
      id: 'flag-1',
      key: 'gift_cards_enabled',
      isEnabled: true,
      description: 'Gift cards',
      rolloutBps: 10_000,
      updatedAt: NOW,
    },
  ];
  const queues =
    options?.queues ??
    [
      {
        id: 'queue-1',
        key: 'GIFT_CARD_MANUAL',
        name: 'گیفت‌کارت دستی',
        description: null,
        isActive: true,
        slaMinutes: 30,
        updatedAt: NOW,
        memberships: [],
        _count: { workItems: 3 },
      },
    ];
  const audits: Array<Record<string, unknown>> = [];
  const transaction = vi.fn(async (callback: (database: unknown) => unknown) => callback(database));

  const database = {
    staffUser: {
      findMany: vi.fn(async ({ where }: any = {}) => {
        if (where?.id?.in) return staff.filter((row) => where.id.in.includes(row.id));
        return staff;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = staff.find(
          (candidate) => candidate.id === where.id || candidate.email === where.email,
        );
        return row === undefined
          ? null
          : { ...row, queueMemberships: [...row.queueMemberships] };
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = staffRow({
          id: `staff-${staff.length + 1}`,
          ...data,
          lastLoginAt: null,
          createdAt: NOW,
          queueMemberships: [],
        });
        staff.push(row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = staff.find((candidate) => candidate.id === where.id)!;
        Object.assign(row, data);
        return { ...row, queueMemberships: [...row.queueMemberships] };
      }),
      delete: vi.fn(async ({ where }: any) => {
        if (options?.deleteErrorCode) throw { code: options.deleteErrorCode };
        const index = staff.findIndex((candidate) => candidate.id === where.id);
        const [deleted] = staff.splice(index, 1);
        return deleted;
      }),
      count: vi.fn(async ({ where }: any) =>
        staff.filter(
          (row) =>
            (where.role === undefined || row.role === where.role) &&
            (where.isActive === undefined || row.isActive === where.isActive),
        ).length,
      ),
    },
    featureFlag: {
      findMany: vi.fn(async () => flags),
      findUnique: vi.fn(async ({ where }: any) => {
        const row = flags.find((flag) => flag.key === where.key);
        return row === undefined ? null : { ...row };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const row = flags.find((flag) => flag.key === where.key)!;
        Object.assign(row, data, { updatedAt: NOW });
        return { ...row };
      }),
    },
    queue: {
      findMany: vi.fn(async () => queues),
      findUnique: vi.fn(async ({ where }: any) =>
        queues.find((queue) => queue.id === where.id) ?? null,
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const row = queues.find((queue) => queue.id === where.id)!;
        Object.assign(row, data, { updatedAt: NOW });
        return row;
      }),
    },
    queueMembership: {
      deleteMany: vi.fn(async ({ where }: any) => {
        const queue = queues.find((candidate) => candidate.id === where.queueId)!;
        const before = queue.memberships.length;
        queue.memberships = queue.memberships.filter(
          (membership) => !where.staffUserId.in.includes(membership.staffUser.id),
        );
        return { count: before - queue.memberships.length };
      }),
      createMany: vi.fn(async ({ data }: any) => {
        for (const membership of data) {
          const queue = queues.find((candidate) => candidate.id === membership.queueId)!;
          const member = staff.find((candidate) => candidate.id === membership.staffUserId)!;
          queue.memberships.push({
            canAssign: membership.canAssign,
            staffUser: {
              id: member.id,
              email: member.email,
              fullName: member.fullName,
              role: member.role,
              isActive: member.isActive,
            },
          });
        }
        return { count: data.length };
      }),
    },
    $transaction: transaction,
  };
  const audit = {
    record: vi.fn(async (entry: Record<string, unknown>) => {
      audits.push(entry);
    }),
  };
  const service = new AdminSettingsService(
    database as unknown as AdminSettingsDatabase,
    audit as unknown as AuditService,
  );
  return { service, staff, flags, queues, audits, database, transaction };
}

describe('AdminSettingsService staff lifecycle', () => {
  it('normalizes email, stores an argon2id hash, and keeps the password out of audit data', async () => {
    const rig = buildRig();
    const password = 'TemporaryPass123';

    const result = await rig.service.createStaff(
      {
        email: ' New.Operator@Barat.Test ',
        fullName: 'اپراتور جدید',
        role: 'OPERATOR',
        password,
      },
      ACTOR,
    );

    const created = rig.staff.find((row) => row.id === result.staff.id)!;
    expect(created.email).toBe('new.operator@barat.test');
    expect(created.passwordHash).not.toBe(password);
    await expect(argon2.verify(created.passwordHash, password)).resolves.toBe(true);
    expect(JSON.stringify(rig.audits)).not.toContain(password);
    expect(rig.audits[0]).toMatchObject({
      action: 'STAFF_CREATED',
      actor: 'admin-1',
      entityId: created.id,
    });
  });

  it('rejects duplicate normalized email addresses', async () => {
    const rig = buildRig();

    await expect(
      rig.service.createStaff(
        {
          email: ' ADMIN-1@BARAT.TEST ',
          fullName: 'مدیر دیگر',
          role: 'ADMIN',
          password: 'TemporaryPass123',
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(rig.audits).toHaveLength(0);
  });

  it('prevents the signed-in administrator from deactivating their own account', async () => {
    const rig = buildRig();

    await expect(
      rig.service.setStaffStatus(
        'admin-1',
        { isActive: false, reason: 'حذف دسترسی این مدیر' },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(rig.staff[0]!.isActive).toBe(true);
  });

  it('prevents deactivation of the final active administrator', async () => {
    const rig = buildRig({
      staff: [
        staffRow({ id: 'admin-1', role: 'ADMIN' }),
        staffRow({ id: 'admin-2', role: 'ADMIN', isActive: false }),
      ],
    });

    await expect(
      rig.service.setStaffStatus(
        'admin-1',
        { isActive: false, reason: 'پایان همکاری مدیر' },
        { ...ACTOR, staff: { ...ADMIN, staffId: 'admin-other' } },
      ),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(rig.staff[0]!.isActive).toBe(true);
  });

  it('deactivates another administrator inside a serializable transaction', async () => {
    const rig = buildRig();

    const result = await rig.service.setStaffStatus(
      'admin-2',
      { isActive: false, reason: 'پایان همکاری مدیر دوم' },
      ACTOR,
    );

    expect(result.staff.isActive).toBe(false);
    expect(rig.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'Serializable',
    });
    expect(rig.audits[0]).toMatchObject({ action: 'STAFF_STATUS_CHANGED' });
  });

  it('requires deactivation before deletion', async () => {
    const rig = buildRig();

    await expect(
      rig.service.deleteStaff('operator-1', { reason: 'حذف حساب آزمایشی' }, ACTOR),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(rig.staff.some((row) => row.id === 'operator-1')).toBe(true);
  });

  it('returns a safe conflict when operational history prevents hard deletion', async () => {
    const rig = buildRig({
      staff: [
        staffRow({ id: 'admin-1', role: 'ADMIN' }),
        staffRow({ id: 'operator-1', role: 'OPERATOR', isActive: false }),
      ],
      deleteErrorCode: 'P2003',
    });

    await expect(
      rig.service.deleteStaff('operator-1', { reason: 'پاک‌سازی حساب قدیمی' }, ACTOR),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      safeMessage: expect.stringContaining('غیرفعال'),
    });
    expect(rig.audits).toHaveLength(0);
  });

  it('deletes an inactive unreferenced account and records the reason', async () => {
    const rig = buildRig({
      staff: [
        staffRow({ id: 'admin-1', role: 'ADMIN' }),
        staffRow({ id: 'operator-1', role: 'OPERATOR', isActive: false }),
      ],
    });

    await expect(
      rig.service.deleteStaff('operator-1', { reason: 'حذف حساب آزمایشی قدیمی' }, ACTOR),
    ).resolves.toEqual({ deleted: true, id: 'operator-1' });
    expect(rig.staff.some((row) => row.id === 'operator-1')).toBe(false);
    expect(rig.audits[0]).toMatchObject({ action: 'STAFF_DELETED' });
  });
});

describe('AdminSettingsService feature flags and queues', () => {
  it('updates only the state and rollout of a known feature flag and audits before/after', async () => {
    const rig = buildRig();

    const result = await rig.service.updateFeatureFlag(
      'gift_cards_enabled',
      { isEnabled: false, rolloutBps: 2_500, reason: 'توقف تدریجی سرویس هدیه' },
      ACTOR,
    );

    expect(result.flag).toMatchObject({ isEnabled: false, rolloutBps: 2_500 });
    expect(rig.audits[0]).toMatchObject({
      action: 'FEATURE_FLAG_UPDATED',
      before: { isEnabled: true, rolloutBps: 10_000 },
    });
  });

  it('replaces only operator memberships and preserves management membership', async () => {
    const manager = staffRow({ id: 'manager-1', role: 'OPS_MANAGER' });
    const oldOperator = staffRow({ id: 'operator-old', role: 'OPERATOR' });
    const newOperator = staffRow({ id: 'operator-new', role: 'OPERATOR' });
    const queue: QueueRow = {
      id: 'queue-1',
      key: 'GIFT_CARD_MANUAL',
      name: 'گیفت‌کارت دستی',
      description: null,
      isActive: true,
      slaMinutes: 30,
      updatedAt: NOW,
      _count: { workItems: 4 },
      memberships: [
        { canAssign: true, staffUser: manager },
        { canAssign: false, staffUser: oldOperator },
      ],
    };
    const rig = buildRig({
      staff: [staffRow({ id: 'admin-1', role: 'ADMIN' }), manager, oldOperator, newOperator],
      queues: [queue],
    });

    const result = await rig.service.replaceQueueOperators(
      'queue-1',
      { staffIds: ['operator-new'], reason: 'تغییر شیفت اپراتورهای صف' },
      ACTOR,
    );

    expect(result.queue.members.map((member) => member.id).sort()).toEqual([
      'manager-1',
      'operator-new',
    ]);
    expect(result.queue.members.find((member) => member.id === 'manager-1')?.canAssign).toBe(true);
    expect(rig.audits[0]).toMatchObject({ action: 'QUEUE_OPERATORS_UPDATED' });
  });

  it('rejects inactive or non-operator queue members without changing memberships', async () => {
    const inactive = staffRow({ id: 'operator-off', role: 'OPERATOR', isActive: false });
    const support = staffRow({ id: 'support-1', role: 'SUPPORT' });
    const rig = buildRig({
      staff: [staffRow({ id: 'admin-1', role: 'ADMIN' }), inactive, support],
    });

    for (const staffId of ['operator-off', 'support-1', 'missing']) {
      await expect(
        rig.service.replaceQueueOperators(
          'queue-1',
          { staffIds: [staffId], reason: 'تنظیم اعضای فعال این صف' },
          ACTOR,
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    }
    expect(rig.database.queueMembership.deleteMany).not.toHaveBeenCalled();
    expect(rig.audits).toHaveLength(0);
  });

  it('updates queue metadata without changing its immutable key', async () => {
    const rig = buildRig();

    const result = await rig.service.updateQueue(
      'queue-1',
      {
        name: 'صف تحویل دستی',
        description: 'تحویل سفارش‌های دستی',
        isActive: false,
        slaMinutes: 45,
        reason: 'توقف دریافت تسک جدید در شیفت شب',
      },
      ACTOR,
    );

    expect(result.queue).toMatchObject({
      key: 'GIFT_CARD_MANUAL',
      name: 'صف تحویل دستی',
      isActive: false,
      slaMinutes: 45,
    });
    expect(rig.audits[0]).toMatchObject({ action: 'QUEUE_UPDATED' });
  });
});
