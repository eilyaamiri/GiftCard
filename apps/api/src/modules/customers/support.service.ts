/* eslint-disable @typescript-eslint/consistent-type-imports -- These classes are
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class from `design:paramtypes` (it becomes `Function`) and Nest can no longer
 * resolve the dependency at runtime. They must stay value imports. */
import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { IdentityActor } from '../identity/identity.tokens';
import type { SupportRequest } from '../identity/identity.schemas';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';

export interface SupportTicketDto {
  readonly id: string;
  readonly code: string;
  readonly subject: string;
  readonly status: string;
  readonly orderId: string | null;
  readonly createdAt: string;
  readonly resolutionNote: string | null;
}

const SUPPORT_QUEUE_KEY = 'CUSTOMER_INFO_REQUIRED' as const;

/**
 * Customer-initiated support requests.
 *
 * A support request is a WorkItem, not a separate inbox — operators already work
 * a single queue surface, and routing customer questions anywhere else would
 * create a second place where a payment problem can be missed.
 */
@Injectable()
export class SupportService {
  constructor(
    @Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase,
    private readonly audit: AuditService,
  ) {}

  async create(
    customerId: string,
    input: SupportRequest,
    actor: IdentityActor,
  ): Promise<SupportTicketDto> {
    let orderId: string | null = null;
    if (input.orderId) {
      /* Scoped to the caller: quoting somebody else's order id must not attach
       * this ticket to their order, and must not confirm that it exists. */
      const order = await this.database.order.findFirst({
        where: { id: input.orderId, customerId },
        select: { id: true },
      });
      if (!order) {
        throw DomainErrors.notFound('Order');
      }
      orderId = order.id;
    }

    const queue = await this.database.queue.upsert({
      where: { key: SUPPORT_QUEUE_KEY },
      create: {
        key: SUPPORT_QUEUE_KEY,
        name: 'Customer information required',
        description: 'Customer-raised questions and information requests.',
      },
      update: {},
      select: { id: true },
    });

    const workItem = await this.database.workItem.create({
      data: {
        code: `SUP-${randomBytes(5).toString('hex').toUpperCase()}`,
        customerId,
        ...(orderId ? { orderId } : {}),
        queueId: queue.id,
        type: 'SUPPORT_REQUEST',
        status: 'UNASSIGNED',
        priority: 100,
        title: input.subject,
        description: input.message,
        /* Deliberately NOT setting activeOrderKey: a support question must never
         * occupy the single active-work-item slot that fulfilment relies on. */
      },
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        orderId: true,
        createdAt: true,
        resolutionNote: true,
      },
    });

    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'SUPPORT_REQUEST_CREATED',
      entity: 'WorkItem',
      entityId: workItem.id,
      after: { subject: input.subject, orderId },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });

    return toDto(workItem);
  }

  async list(customerId: string): Promise<readonly SupportTicketDto[]> {
    const rows = await this.database.workItem.findMany({
      where: { customerId, type: 'SUPPORT_REQUEST' },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        code: true,
        title: true,
        status: true,
        orderId: true,
        createdAt: true,
        resolutionNote: true,
      },
    });
    return rows.map(toDto);
  }
}

function toDto(row: {
  id: string;
  code: string;
  title: string;
  status: string;
  orderId: string | null;
  createdAt: Date;
  resolutionNote: string | null;
}): SupportTicketDto {
  return {
    id: row.id,
    code: row.code,
    subject: row.title,
    status: row.status,
    orderId: row.orderId,
    createdAt: row.createdAt.toISOString(),
    resolutionNote: row.resolutionNote,
  };
}
