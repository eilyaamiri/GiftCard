import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import {
  isExternalSupportChannel,
  normalizeSupportChannelValue,
  supportChannelHref,
  type SupportChannelKind,
  type UpdateSupportChannelInput,
} from './support-channels.schemas';

export const SUPPORT_CHANNELS_DATABASE = Symbol('SUPPORT_CHANNELS_DATABASE');

export type SupportChannelsDatabase = Pick<PrismaClient, 'supportChannel'>;

export const SUPPORT_CHANNEL_AUDIT_ACTION = 'SUPPORT_CHANNEL_UPDATED';

/** What a customer sees: a label, a line of copy, and a link already built. */
export interface PublicSupportChannelDto {
  readonly kind: SupportChannelKind;
  readonly title: string;
  readonly description: string;
  readonly href: string;
  readonly isExternal: boolean;
  /** Whether following the link requires a signed-in customer. */
  readonly requiresAuth: boolean;
}

/** What an admin edits: the raw stored value, plus the state around it. */
export interface AdminSupportChannelDto {
  readonly kind: SupportChannelKind;
  readonly isEnabled: boolean;
  readonly title: string;
  readonly description: string;
  readonly value: string;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

interface SupportChannelActor {
  readonly staff: AuthenticatedStaff;
  readonly metadata: IdentityActor;
}

const SELECT = {
  id: true,
  kind: true,
  isEnabled: true,
  title: true,
  description: true,
  value: true,
  sortOrder: true,
  updatedAt: true,
} as const;

/**
 * The contact routes offered on the storefront, and the admin controls for them.
 *
 * The set of channels is closed: rows are created by migration and this service
 * only ever updates them, so an admin cannot introduce an outbound link of a
 * kind nobody vetted. What an admin types is normalised and validated per kind
 * before it is stored, and the public list hands the storefront a finished
 * `href` so that no link is ever assembled in a browser.
 */
@Injectable()
export class SupportChannelsService {
  constructor(
    @Inject(SUPPORT_CHANNELS_DATABASE) private readonly database: SupportChannelsDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Channels a customer may actually use.
   *
   * A channel that is enabled but has no value is dropped rather than rendered
   * as a dead row — the two states are separate on purpose, so that clearing a
   * number takes it off the storefront without anyone remembering to also
   * switch the channel off.
   */
  async listPublic(): Promise<{ items: readonly PublicSupportChannelDto[] }> {
    const rows = await this.database.supportChannel.findMany({
      where: { isEnabled: true, NOT: { value: '' } },
      select: SELECT,
      orderBy: [{ sortOrder: 'asc' }, { kind: 'asc' }],
    });

    const items: PublicSupportChannelDto[] = [];
    for (const row of rows) {
      const kind = row.kind as SupportChannelKind;
      const href = supportChannelHref(kind, row.value);
      if (href === null) continue;
      items.push({
        kind,
        title: row.title,
        description: row.description,
        href,
        isExternal: isExternalSupportChannel(kind),
        requiresAuth: kind === 'TICKET',
      });
    }
    return { items };
  }

  async listForAdmin(): Promise<{ items: readonly AdminSupportChannelDto[] }> {
    const rows = await this.database.supportChannel.findMany({
      select: SELECT,
      orderBy: [{ sortOrder: 'asc' }, { kind: 'asc' }],
    });
    return { items: rows.map(toAdminView) };
  }

  async update(
    kind: SupportChannelKind,
    input: UpdateSupportChannelInput,
    actor: SupportChannelActor,
  ): Promise<{ channel: AdminSupportChannelDto }> {
    const current = await this.database.supportChannel.findUnique({
      where: { kind },
      select: SELECT,
    });
    if (current === null) {
      throw DomainErrors.notFound('support channel');
    }

    const value = normalizeSupportChannelValue(kind, input.value);
    if (input.isEnabled && value === '') {
      throw DomainErrors.validation([
        { path: 'value', message: 'برای فعال‌کردن این کانال باید مقدار آن را وارد کنید.' },
      ]);
    }

    const updated = await this.database.supportChannel.update({
      where: { kind },
      data: {
        isEnabled: input.isEnabled,
        title: input.title,
        description: input.description,
        value,
        sortOrder: input.sortOrder,
        updatedByStaffId: actor.staff.staffId,
      },
      select: SELECT,
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: SUPPORT_CHANNEL_AUDIT_ACTION,
      entity: 'SupportChannel',
      entityId: current.id,
      before: {
        isEnabled: current.isEnabled,
        title: current.title,
        description: current.description,
        value: current.value,
        sortOrder: current.sortOrder,
      },
      after: {
        isEnabled: updated.isEnabled,
        title: updated.title,
        description: updated.description,
        value: updated.value,
        sortOrder: updated.sortOrder,
      },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { channel: toAdminView(updated) };
  }
}

function toAdminView(row: {
  kind: string;
  isEnabled: boolean;
  title: string;
  description: string;
  value: string;
  sortOrder: number;
  updatedAt: Date;
}): AdminSupportChannelDto {
  return {
    kind: row.kind as SupportChannelKind,
    isEnabled: row.isEnabled,
    title: row.title,
    description: row.description,
    value: row.value,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}
