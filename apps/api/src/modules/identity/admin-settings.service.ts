import { Inject, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import type { FeatureFlagKey, QueueKey, StaffRole } from '@barat/contracts';
import type { Prisma, PrismaClient } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, IdentityActor } from './identity.tokens';
import { normalizeEmail } from './identity.utils';
import type {
  CreateStaffInput,
  DeleteStaffInput,
  ReplaceQueueOperatorsInput,
  StaffStatusInput,
  UpdateFeatureFlagInput,
  UpdateQueueInput,
} from './admin-settings.schemas';

export const ADMIN_SETTINGS_DATABASE = Symbol('ADMIN_SETTINGS_DATABASE');

export type AdminSettingsDatabase = Pick<
  PrismaClient,
  'staffUser' | 'featureFlag' | 'queue' | 'queueMembership' | '$transaction'
>;

export const ADMIN_SETTINGS_AUDIT_ACTIONS = {
  STAFF_CREATED: 'STAFF_CREATED',
  STAFF_STATUS_CHANGED: 'STAFF_STATUS_CHANGED',
  STAFF_DELETED: 'STAFF_DELETED',
  FEATURE_FLAG_UPDATED: 'FEATURE_FLAG_UPDATED',
  QUEUE_UPDATED: 'QUEUE_UPDATED',
  QUEUE_OPERATORS_UPDATED: 'QUEUE_OPERATORS_UPDATED',
} as const;

const STAFF_SELECT = {
  id: true,
  email: true,
  fullName: true,
  role: true,
  isActive: true,
  lastLoginAt: true,
  createdAt: true,
  queueMemberships: {
    select: {
      queue: { select: { id: true, key: true, name: true } },
    },
    orderBy: { queue: { key: 'asc' } },
  },
} satisfies Prisma.StaffUserSelect;

type StaffRow = Prisma.StaffUserGetPayload<{ select: typeof STAFF_SELECT }>;

const QUEUE_SELECT = {
  id: true,
  key: true,
  name: true,
  description: true,
  isActive: true,
  slaMinutes: true,
  updatedAt: true,
  memberships: {
    select: {
      canAssign: true,
      staffUser: {
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
        },
      },
    },
    orderBy: { staffUser: { fullName: 'asc' } },
  },
  _count: { select: { workItems: true } },
} satisfies Prisma.QueueSelect;

type QueueRow = Prisma.QueueGetPayload<{ select: typeof QUEUE_SELECT }>;

export interface StaffAdminView {
  readonly id: string;
  readonly email: string;
  readonly fullName: string;
  readonly role: StaffRole;
  readonly isActive: boolean;
  readonly lastLoginAt: string | null;
  readonly createdAt: string;
  readonly queues: readonly {
    readonly id: string;
    readonly key: QueueKey;
    readonly name: string;
  }[];
}

export interface FeatureFlagAdminView {
  readonly id: string;
  readonly key: FeatureFlagKey;
  readonly isEnabled: boolean;
  readonly description: string | null;
  readonly rolloutBps: number;
  readonly updatedAt: string;
}

export interface QueueAdminView {
  readonly id: string;
  readonly key: QueueKey;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly slaMinutes: number | null;
  readonly workItemCount: number;
  readonly updatedAt: string;
  readonly members: readonly {
    readonly id: string;
    readonly email: string;
    readonly fullName: string;
    readonly role: StaffRole;
    readonly isActive: boolean;
    readonly canAssign: boolean;
  }[];
}

interface SettingsActor {
  readonly staff: AuthenticatedStaff;
  readonly metadata: IdentityActor;
}

/**
 * Human-gated controls for staff access and operational configuration.
 *
 * Passwords are hashed before persistence and never enter an audit payload.
 * Access removal is deliberately two-step: an account must be deactivated before
 * it can be deleted, and the current or final active administrator cannot be
 * deactivated or removed.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(ADMIN_SETTINGS_DATABASE) private readonly database: AdminSettingsDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listStaff(): Promise<{ items: readonly StaffAdminView[] }> {
    const rows = await this.database.staffUser.findMany({
      select: STAFF_SELECT,
      orderBy: [{ isActive: 'desc' }, { fullName: 'asc' }],
    });
    return { items: rows.map(toStaffView) };
  }

  async createStaff(
    input: CreateStaffInput,
    actor: SettingsActor,
  ): Promise<{ staff: StaffAdminView }> {
    const email = normalizeEmail(input.email);
    const duplicate = await this.database.staffUser.findUnique({
      where: { email },
      select: { id: true },
    });
    if (duplicate !== null) {
      throw DomainErrors.conflict(
        'کاربری با این ایمیل قبلاً ثبت شده است.',
        `staff email ${email} already exists`,
      );
    }

    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    let row: StaffRow;
    try {
      row = await this.database.staffUser.create({
        data: {
          email,
          fullName: input.fullName.trim(),
          role: input.role,
          passwordHash,
          isActive: true,
        },
        select: STAFF_SELECT,
      });
    } catch (error) {
      if (hasDatabaseCode(error, 'P2002')) {
        throw DomainErrors.conflict(
          'کاربری با این ایمیل قبلاً ثبت شده است.',
          `staff email ${email} raced with another create`,
        );
      }
      throw error;
    }

    await this.recordAudit(actor, {
      action: ADMIN_SETTINGS_AUDIT_ACTIONS.STAFF_CREATED,
      entity: 'StaffUser',
      entityId: row.id,
      after: {
        email: row.email,
        fullName: row.fullName,
        role: row.role,
        isActive: row.isActive,
      },
    });
    return { staff: toStaffView(row) };
  }

  async setStaffStatus(
    staffId: string,
    input: StaffStatusInput,
    actor: SettingsActor,
  ): Promise<{ staff: StaffAdminView }> {
    const current = await this.staffById(staffId);
    if (current.isActive === input.isActive) {
      return { staff: toStaffView(current) };
    }
    if (!input.isActive && current.id === actor.staff.staffId) {
      throw DomainErrors.conflict(
        'امکان غیرفعال‌کردن حسابی که با آن وارد شده‌اید وجود ندارد.',
        `staff ${current.id} tried to deactivate their own account`,
      );
    }

    let updated: StaffRow;
    if (!input.isActive && current.role === 'ADMIN') {
      try {
        updated = await this.database.$transaction(
          async (transaction) => {
            const activeAdmins = await transaction.staffUser.count({
              where: { role: 'ADMIN', isActive: true },
            });
            if (activeAdmins <= 1) {
              throw DomainErrors.conflict(
                'آخرین مدیر فعال سامانه را نمی‌توان غیرفعال کرد.',
                `staff ${current.id} is the final active administrator`,
              );
            }
            return transaction.staffUser.update({
              where: { id: staffId },
              data: { isActive: false },
              select: STAFF_SELECT,
            });
          },
          { isolationLevel: 'Serializable' },
        );
      } catch (error) {
        if (hasDatabaseCode(error, 'P2034')) {
          throw DomainErrors.conflict(
            'وضعیت مدیران هم‌زمان تغییر کرده است؛ فهرست را تازه‌سازی و دوباره بررسی کنید.',
            `serializable conflict while deactivating administrator ${staffId}`,
          );
        }
        throw error;
      }
    } else {
      updated = await this.database.staffUser.update({
        where: { id: staffId },
        data: { isActive: input.isActive },
        select: STAFF_SELECT,
      });
    }
    await this.recordAudit(actor, {
      action: ADMIN_SETTINGS_AUDIT_ACTIONS.STAFF_STATUS_CHANGED,
      entity: 'StaffUser',
      entityId: staffId,
      before: { isActive: current.isActive },
      after: { isActive: updated.isActive, reason: input.reason },
    });
    return { staff: toStaffView(updated) };
  }

  async deleteStaff(
    staffId: string,
    input: DeleteStaffInput,
    actor: SettingsActor,
  ): Promise<{ deleted: true; id: string }> {
    const current = await this.staffById(staffId);
    if (current.id === actor.staff.staffId) {
      throw DomainErrors.conflict(
        'امکان حذف حسابی که با آن وارد شده‌اید وجود ندارد.',
        `staff ${staffId} tried to delete their own account`,
      );
    }
    if (current.isActive) {
      throw DomainErrors.conflict(
        'پیش از حذف، حساب کارمند را غیرفعال کنید.',
        `active staff ${staffId} cannot be deleted`,
      );
    }

    try {
      await this.database.staffUser.delete({ where: { id: staffId } });
    } catch (error) {
      if (hasDatabaseCode(error, 'P2003')) {
        throw DomainErrors.conflict(
          'این حساب سابقهٔ عملیاتی دارد و قابل حذف نیست؛ آن را غیرفعال نگه دارید.',
          `staff ${staffId} is referenced by operational records`,
        );
      }
      throw error;
    }

    await this.recordAudit(actor, {
      action: ADMIN_SETTINGS_AUDIT_ACTIONS.STAFF_DELETED,
      entity: 'StaffUser',
      entityId: staffId,
      before: {
        email: current.email,
        fullName: current.fullName,
        role: current.role,
        isActive: current.isActive,
      },
      after: { deleted: true, reason: input.reason },
    });
    return { deleted: true, id: staffId };
  }

  async listFeatureFlags(): Promise<{ items: readonly FeatureFlagAdminView[] }> {
    const rows = await this.database.featureFlag.findMany({
      select: {
        id: true,
        key: true,
        isEnabled: true,
        description: true,
        rolloutBps: true,
        updatedAt: true,
      },
      orderBy: { key: 'asc' },
    });
    return {
      items: rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString() })),
    };
  }

  async updateFeatureFlag(
    key: FeatureFlagKey,
    input: UpdateFeatureFlagInput,
    actor: SettingsActor,
  ): Promise<{ flag: FeatureFlagAdminView }> {
    const current = await this.database.featureFlag.findUnique({
      where: { key },
      select: {
        id: true,
        key: true,
        isEnabled: true,
        description: true,
        rolloutBps: true,
        updatedAt: true,
      },
    });
    if (current === null) {
      throw DomainErrors.notFound('feature flag');
    }

    const updated = await this.database.featureFlag.update({
      where: { key },
      data: { isEnabled: input.isEnabled, rolloutBps: input.rolloutBps },
      select: {
        id: true,
        key: true,
        isEnabled: true,
        description: true,
        rolloutBps: true,
        updatedAt: true,
      },
    });
    await this.recordAudit(actor, {
      action: ADMIN_SETTINGS_AUDIT_ACTIONS.FEATURE_FLAG_UPDATED,
      entity: 'FeatureFlag',
      entityId: current.id,
      before: { isEnabled: current.isEnabled, rolloutBps: current.rolloutBps },
      after: {
        isEnabled: updated.isEnabled,
        rolloutBps: updated.rolloutBps,
        reason: input.reason,
      },
    });
    return {
      flag: { ...updated, updatedAt: updated.updatedAt.toISOString() },
    };
  }

  async listQueues(): Promise<{ items: readonly QueueAdminView[] }> {
    const rows = await this.database.queue.findMany({
      select: QUEUE_SELECT,
      orderBy: { key: 'asc' },
    });
    return { items: rows.map(toQueueView) };
  }

  async updateQueue(
    queueId: string,
    input: UpdateQueueInput,
    actor: SettingsActor,
  ): Promise<{ queue: QueueAdminView }> {
    const current = await this.queueById(queueId);
    const updated = await this.database.queue.update({
      where: { id: queueId },
      data: {
        name: input.name.trim(),
        description: emptyToNull(input.description),
        isActive: input.isActive,
        slaMinutes: input.slaMinutes,
      },
      select: QUEUE_SELECT,
    });
    await this.recordAudit(actor, {
      action: ADMIN_SETTINGS_AUDIT_ACTIONS.QUEUE_UPDATED,
      entity: 'Queue',
      entityId: queueId,
      before: queueAuditView(current),
      after: { ...queueAuditView(updated), reason: input.reason },
    });
    return { queue: toQueueView(updated) };
  }

  async replaceQueueOperators(
    queueId: string,
    input: ReplaceQueueOperatorsInput,
    actor: SettingsActor,
  ): Promise<{ queue: QueueAdminView }> {
    const current = await this.queueById(queueId);
    const staff = await this.database.staffUser.findMany({
      where: { id: { in: input.staffIds } },
      select: { id: true, role: true, isActive: true },
    });
    const validIds = new Set(
      staff
        .filter((member) => member.role === 'OPERATOR' && member.isActive)
        .map((member) => member.id),
    );
    const invalidId = input.staffIds.find((staffId) => !validIds.has(staffId));
    if (invalidId !== undefined) {
      throw DomainErrors.validation([
        {
          path: 'staffIds',
          message: 'فقط اپراتورهای فعال را می‌توان عضو صف کرد.',
        },
      ]);
    }

    const operatorMembershipIds = current.memberships
      .filter((membership) => membership.staffUser.role === 'OPERATOR')
      .map((membership) => membership.staffUser.id);
    const rowsToDelete = current.memberships
      .filter((membership) => membership.staffUser.role === 'OPERATOR')
      .map((membership) => membership.staffUser.id);

    await this.database.$transaction(async (transaction) => {
      if (rowsToDelete.length > 0) {
        await transaction.queueMembership.deleteMany({
          where: { queueId, staffUserId: { in: rowsToDelete } },
        });
      }
      if (input.staffIds.length > 0) {
        await transaction.queueMembership.createMany({
          data: input.staffIds.map((staffUserId) => ({
            queueId,
            staffUserId,
            canAssign: false,
          })),
          skipDuplicates: true,
        });
      }
    });

    const updated = await this.queueById(queueId);
    await this.recordAudit(actor, {
      action: ADMIN_SETTINGS_AUDIT_ACTIONS.QUEUE_OPERATORS_UPDATED,
      entity: 'Queue',
      entityId: queueId,
      before: { operatorStaffIds: operatorMembershipIds },
      after: { operatorStaffIds: input.staffIds, reason: input.reason },
    });
    return { queue: toQueueView(updated) };
  }

  private async staffById(staffId: string): Promise<StaffRow> {
    const row = await this.database.staffUser.findUnique({
      where: { id: staffId },
      select: STAFF_SELECT,
    });
    if (row === null) throw DomainErrors.notFound('staff user');
    return row;
  }

  private async queueById(queueId: string): Promise<QueueRow> {
    const row = await this.database.queue.findUnique({
      where: { id: queueId },
      select: QUEUE_SELECT,
    });
    if (row === null) throw DomainErrors.notFound('queue');
    return row;
  }

  private recordAudit(
    actor: SettingsActor,
    change: {
      readonly action: string;
      readonly entity: string;
      readonly entityId: string;
      readonly before?: unknown;
      readonly after?: unknown;
    },
  ): Promise<void> {
    return this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: change.action,
      entity: change.entity,
      entityId: change.entityId,
      ...(change.before === undefined ? {} : { before: change.before }),
      ...(change.after === undefined ? {} : { after: change.after }),
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });
  }
}

function toStaffView(row: StaffRow): StaffAdminView {
  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    queues: row.queueMemberships.map((membership) => membership.queue),
  };
}

function toQueueView(row: QueueRow): QueueAdminView {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    slaMinutes: row.slaMinutes,
    workItemCount: row._count.workItems,
    updatedAt: row.updatedAt.toISOString(),
    members: row.memberships.map((membership) => ({
      ...membership.staffUser,
      canAssign: membership.canAssign,
    })),
  };
}

function queueAuditView(row: QueueRow): {
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly slaMinutes: number | null;
} {
  return {
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    slaMinutes: row.slaMinutes,
  };
}

function emptyToNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function hasDatabaseCode(error: unknown, code: string): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === code
  );
}
