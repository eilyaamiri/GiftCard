import { Inject, Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@barat/database';

import { deepRedact, type RedactedJson } from './deep-redactor';

/**
 * Prisma refuses a bare `null` on a nullable Json column (it cannot tell SQL
 * NULL from JSON null), and the sentinel that resolves the ambiguity is a
 * runtime import of the client. Importing it here would drag the database
 * singleton — and therefore DATABASE_URL — into every consumer of this file, so
 * a redacted `null` is simply left out: an absent column already reads as
 * "nothing was recorded for this side of the change".
 */
function toJsonInput(value: RedactedJson): Prisma.InputJsonValue | undefined {
  return value === null ? undefined : (value as Prisma.InputJsonValue);
}

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

export const AUDIT_DATABASE = Symbol('AUDIT_DATABASE');
export const AUDIT_WRITER = Symbol('AUDIT_WRITER');

@Injectable()
export class PrismaAuditWriter implements AuditWriter {
  constructor(
    @Inject(AUDIT_DATABASE)
    private readonly database: Pick<PrismaClient, 'auditLog'>,
  ) {}

  async append(input: Parameters<AuditWriter['append']>[0]): Promise<void> {
    const before = input.before === undefined ? undefined : toJsonInput(input.before);
    const after = input.after === undefined ? undefined : toJsonInput(input.after);

    await this.database.auditLog.create({
      data: {
        actor: input.actor,
        actorType: input.actorType,
        actorRole: input.actorRole,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        ...(before === undefined ? {} : { before }),
        ...(after === undefined ? {} : { after }),
        ip: input.ip,
        userAgent: input.userAgent,
        requestId: input.requestId,
      },
    });
  }
}

/** Append-only audit facade. It intentionally exposes no update/delete method. */
@Injectable()
export class AuditService {
  constructor(@Inject(AUDIT_WRITER) private readonly writer: AuditWriter) {}

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
