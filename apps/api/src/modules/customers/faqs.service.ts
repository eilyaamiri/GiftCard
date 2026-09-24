import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import type { CreateFaqInput, UpdateFaqInput } from './faqs.schemas';

export const FAQS_DATABASE = Symbol('FAQS_DATABASE');

export type FaqsDatabase = Pick<PrismaClient, 'faq'>;

export const FAQ_CREATED_AUDIT_ACTION = 'FAQ_CREATED';
export const FAQ_UPDATED_AUDIT_ACTION = 'FAQ_UPDATED';
export const FAQ_DELETED_AUDIT_ACTION = 'FAQ_DELETED';

/** What a customer sees: only the pairs an admin has published, in display order. */
export interface PublicFaqDto {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
}

/** What an admin edits: every row, published or not. */
export interface AdminFaqDto {
  readonly id: string;
  readonly question: string;
  readonly answer: string;
  readonly isEnabled: boolean;
  readonly sortOrder: number;
  readonly updatedAt: string;
}

interface FaqActor {
  readonly staff: AuthenticatedStaff;
  readonly metadata: IdentityActor;
}

const SELECT = {
  id: true,
  question: true,
  answer: true,
  isEnabled: true,
  sortOrder: true,
  updatedAt: true,
} as const;

/**
 * The storefront's FAQ list, and the admin controls for it.
 *
 * Unlike support channels this set is open-ended: an admin creates and removes
 * rows freely, not just edits a fixed list, so the service exposes create and
 * delete alongside update.
 */
@Injectable()
export class FaqsService {
  constructor(
    @Inject(FAQS_DATABASE) private readonly database: FaqsDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async listPublic(): Promise<{ items: readonly PublicFaqDto[] }> {
    const rows = await this.database.faq.findMany({
      where: { isEnabled: true },
      select: SELECT,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map((row) => ({ id: row.id, question: row.question, answer: row.answer })) };
  }

  async listForAdmin(): Promise<{ items: readonly AdminFaqDto[] }> {
    const rows = await this.database.faq.findMany({
      select: SELECT,
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items: rows.map(toAdminView) };
  }

  async create(input: CreateFaqInput, actor: FaqActor): Promise<{ faq: AdminFaqDto }> {
    const created = await this.database.faq.create({
      data: {
        question: input.question,
        answer: input.answer,
        isEnabled: input.isEnabled,
        sortOrder: input.sortOrder,
        updatedByStaffId: actor.staff.staffId,
      },
      select: SELECT,
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: FAQ_CREATED_AUDIT_ACTION,
      entity: 'Faq',
      entityId: created.id,
      before: null,
      after: { question: created.question, answer: created.answer, isEnabled: created.isEnabled, sortOrder: created.sortOrder },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { faq: toAdminView(created) };
  }

  async update(id: string, input: UpdateFaqInput, actor: FaqActor): Promise<{ faq: AdminFaqDto }> {
    const current = await this.database.faq.findUnique({ where: { id }, select: SELECT });
    if (current === null) {
      throw DomainErrors.notFound('faq');
    }

    const updated = await this.database.faq.update({
      where: { id },
      data: {
        question: input.question,
        answer: input.answer,
        isEnabled: input.isEnabled,
        sortOrder: input.sortOrder,
        updatedByStaffId: actor.staff.staffId,
      },
      select: SELECT,
    });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: FAQ_UPDATED_AUDIT_ACTION,
      entity: 'Faq',
      entityId: current.id,
      before: { question: current.question, answer: current.answer, isEnabled: current.isEnabled, sortOrder: current.sortOrder },
      after: { question: updated.question, answer: updated.answer, isEnabled: updated.isEnabled, sortOrder: updated.sortOrder },
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { faq: toAdminView(updated) };
  }

  async remove(id: string, actor: FaqActor): Promise<{ id: string }> {
    const current = await this.database.faq.findUnique({ where: { id }, select: SELECT });
    if (current === null) {
      throw DomainErrors.notFound('faq');
    }

    await this.database.faq.delete({ where: { id } });

    await this.audit.record({
      actor: actor.staff.staffId,
      actorType: 'STAFF',
      actorRole: actor.staff.role,
      action: FAQ_DELETED_AUDIT_ACTION,
      entity: 'Faq',
      entityId: current.id,
      before: { question: current.question, answer: current.answer, isEnabled: current.isEnabled, sortOrder: current.sortOrder },
      after: null,
      ip: actor.metadata.ip,
      userAgent: actor.metadata.userAgent,
    });

    return { id };
  }
}

function toAdminView(row: {
  id: string;
  question: string;
  answer: string;
  isEnabled: boolean;
  sortOrder: number;
  updatedAt: Date;
}): AdminFaqDto {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    isEnabled: row.isEnabled,
    sortOrder: row.sortOrder,
    updatedAt: row.updatedAt.toISOString(),
  };
}
