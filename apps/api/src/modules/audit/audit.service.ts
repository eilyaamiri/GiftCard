import { Injectable } from '@nestjs/common';
import { prisma } from '@barat/database';

import { deepRedact, type RedactedJson } from './deep-redactor';

export type AuditActorType = 'CUSTOMER' | 'STAFF' | 'SYSTEM' | 'ANONYMOUS';

export interface RecordAuditInput {
  readonly actor: string;
  readonly actorType?: AuditActorType;
  readonly actorRole?: string | null;
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
  readonly requestId?: string | null;
}

export interface AuditWriter {
  append(input: {
    actor: string;
    actorType: AuditActorType;
    actorRole: string | null;
    action: string;
    entity: string;
    entityId: string;
    before?: RedactedJson;
    after?: RedactedJson;
    ip: string | null;
    userAgent: string | null;
    requestId: string | null;
  }): Promise<void>;
}

@Injectable()
export class PrismaAuditWriter implements AuditWriter {
  async append(input: Parameters<AuditWriter['append']>[0]): Promise<void> {
    await prisma.auditLog.create({
      data: {
        actor: input.actor,
        actorType: input.actorType,
        actorRole: input.actorRole,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        ...(input.before === undefined ? {} : { before: input.before }),
        ...(input.after === undefined ? {} : { after: input.after }),
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
      },
    });
  }
}

export const AUDIT_WRITER = Symbol('AUDIT_WRITER');

/** Append-only audit facade. It intentionally exposes no update/delete method. */
@Injectable()
export class AuditService {
  constructor(private readonly writer: PrismaAuditWriter) {}

  async record(input: RecordAuditInput): Promise<void> {
    const before = deepRedact(input.before);
    const after = deepRedact(input.after);

    await this.writer.append({
      actor: input.actor,
      actorType: input.actorType ?? 'STAFF',
      actorRole: input.actorRole ?? null,
      action: input.action,
      entity: input.entity,
      entityId: input.entityId,
      ...(before === undefined ? {} : { before }),
      ...(after === undefined ? {} : { after }),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      requestId: input.requestId ?? null,
    });
  }
}
