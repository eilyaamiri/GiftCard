import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@barat/database';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import type { SupportReply, SupportRequest } from '../identity/identity.schemas';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';

const SUPPORT_QUEUE_KEY = 'CUSTOMER_INFO_REQUIRED' as const;
const FIRST_RESPONSE_SLA_MS = 30 * 60_000;
const NEXT_RESPONSE_SLA_MS = 60 * 60_000;

const TICKET_INCLUDE = {
  workItem: {
    include: {
      customer: { include: { profile: true } },
      order: { select: { orderNumber: true } },
    },
  },
  owner: { select: { id: true, fullName: true } },
  messages: {
    orderBy: { createdAt: 'asc' },
    include: { staff: { select: { fullName: true } } },
  },
  ownershipEvents: {
    orderBy: { createdAt: 'asc' },
    include: {
      previousStaff: { select: { fullName: true } },
      newStaff: { select: { fullName: true } },
      changedBy: { select: { fullName: true } },
    },
  },
} satisfies Prisma.SupportTicketInclude;

type TicketRow = Prisma.SupportTicketGetPayload<{ include: typeof TICKET_INCLUDE }>;

export interface SupportTicketDto {
  readonly id: string;
  readonly workItemId: string;
  readonly code: string;
  readonly subject: string;
  readonly status: string;
  readonly customerId: string;
  readonly customerName: string | null;
  readonly customerCode: string;
  readonly orderId: string | null;
  readonly orderNumber: string | null;
  readonly ownerStaffId: string | null;
  readonly ownerStaffName: string | null;
  readonly createdAt: string;
  readonly firstResponseDueAt: string;
  readonly nextResponseDueAt: string;
  readonly firstRespondedAt: string | null;
  readonly lastRespondedAt: string | null;
  readonly firstResponseBreached: boolean;
  readonly responseBreached: boolean;
  readonly resolutionNote: string | null;
  readonly messages: readonly SupportMessageDto[];
  readonly ownershipHistory: readonly SupportOwnershipDto[];
}

export interface SupportMessageDto {
  readonly id: string;
  readonly authorType: 'CUSTOMER' | 'STAFF';
  readonly authorName: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface SupportOwnershipDto {
  readonly id: string;
  readonly previousOwnerName: string | null;
  readonly newOwnerName: string;
  readonly changedByName: string;
  readonly reason: string;
  readonly createdAt: string;
}

@Injectable()
export class SupportService {
  constructor(
    @Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async create(customerId: string, input: SupportRequest, actor: IdentityActor): Promise<SupportTicketDto> {
    let orderId: string | null = null;
    if (input.orderId) {
      const order = await this.database.order.findFirst({
        where: { id: input.orderId, customerId },
        select: { id: true },
      });
      if (!order) throw DomainErrors.notFound('Order');
      orderId = order.id;
    }

    const queue = await this.database.queue.upsert({
      where: { key: SUPPORT_QUEUE_KEY },
      create: {
        key: SUPPORT_QUEUE_KEY,
        name: 'Customer support',
        description: 'Customer-raised support tickets.',
      },
      update: {},
      select: { id: true },
    });
    const now = new Date();
    const row = await this.database.$transaction(async (tx) => {
      const workItem = await tx.workItem.create({
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
          dueAt: new Date(now.getTime() + FIRST_RESPONSE_SLA_MS),
        },
        select: { id: true },
      });
      const ticket = await tx.supportTicket.create({
        data: {
          workItemId: workItem.id,
          firstResponseDueAt: new Date(now.getTime() + FIRST_RESPONSE_SLA_MS),
          nextResponseDueAt: new Date(now.getTime() + FIRST_RESPONSE_SLA_MS),
          messages: {
            create: { authorType: 'CUSTOMER', customerId, body: input.message },
          },
        },
        select: { id: true },
      });
      return tx.supportTicket.findUniqueOrThrow({ where: { id: ticket.id }, include: TICKET_INCLUDE });
    });

    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'SUPPORT_TICKET_CREATED',
      entity: 'SupportTicket',
      entityId: row.id,
      after: { workItemId: row.workItemId, orderId },
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return toDto(row);
  }

  async list(customerId: string): Promise<readonly SupportTicketDto[]> {
    const rows = await this.database.supportTicket.findMany({
      where: { workItem: { customerId } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: TICKET_INCLUDE,
    });
    return rows.map(toDto);
  }

  async listAll(): Promise<readonly SupportTicketDto[]> {
    const rows = await this.database.supportTicket.findMany({
      orderBy: [{ nextResponseDueAt: 'asc' }, { createdAt: 'desc' }],
      take: 250,
      include: TICKET_INCLUDE,
    });
    return rows.map(toDto);
  }

  async getForStaff(ticketId: string): Promise<SupportTicketDto> {
    const row = await this.database.supportTicket.findUnique({ where: { id: ticketId }, include: TICKET_INCLUDE });
    if (row === null) throw DomainErrors.notFound(`support ticket ${ticketId}`);
    return toDto(row);
  }

  async getForCustomer(customerId: string, ticketId: string): Promise<SupportTicketDto> {
    const row = await this.database.supportTicket.findFirst({
      where: { id: ticketId, workItem: { customerId } },
      include: TICKET_INCLUDE,
    });
    if (row === null) throw DomainErrors.notFound(`support ticket ${ticketId}`);
    return toDto(row);
  }

  async replyAsCustomer(
    customerId: string,
    ticketId: string,
    input: SupportReply,
    actor: IdentityActor,
  ): Promise<SupportTicketDto> {
    const ticket = await this.database.supportTicket.findFirst({
      where: { id: ticketId, workItem: { customerId } },
      select: { id: true, workItemId: true, closedAt: true },
    });
    if (ticket === null) throw DomainErrors.notFound(`support ticket ${ticketId}`);
    if (ticket.closedAt !== null) throw DomainErrors.conflict('این تیکت بسته شده است.', `ticket ${ticketId} is closed`);
    const now = new Date();
    const row = await this.database.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: { ticketId, authorType: 'CUSTOMER', customerId, body: input.message.trim() },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: { nextResponseDueAt: new Date(now.getTime() + NEXT_RESPONSE_SLA_MS) },
      });
      await tx.workItem.update({
        where: { id: ticket.workItemId },
        data: { status: 'IN_PROGRESS', dueAt: new Date(now.getTime() + NEXT_RESPONSE_SLA_MS) },
      });
      return tx.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, include: TICKET_INCLUDE });
    });
    await this.audit.record({
      actor: customerId,
      actorType: 'CUSTOMER',
      action: 'SUPPORT_TICKET_CUSTOMER_REPLIED',
      entity: 'SupportTicket',
      entityId: ticketId,
      ip: actor.ip,
      userAgent: actor.userAgent,
    });
    return toDto(row);
  }

  async replyAsStaff(
    staff: AuthenticatedStaff,
    ticketId: string,
    input: SupportReply,
  ): Promise<SupportTicketDto> {
    const ticket = await this.database.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, workItemId: true, ownerStaffId: true, firstRespondedAt: true, closedAt: true },
    });
    if (ticket === null) throw DomainErrors.notFound(`support ticket ${ticketId}`);
    if (ticket.closedAt !== null) throw DomainErrors.conflict('این تیکت بسته شده است.', `ticket ${ticketId} is closed`);
    const now = new Date();
    const ownerChanged = ticket.ownerStaffId !== staff.staffId;
    const row = await this.database.$transaction(async (tx) => {
      await tx.supportMessage.create({
        data: { ticketId, authorType: 'STAFF', staffId: staff.staffId, body: input.message.trim() },
      });
      if (ownerChanged) {
        await tx.supportOwnershipEvent.create({
          data: {
            ticketId,
            previousStaffId: ticket.ownerStaffId,
            newStaffId: staff.staffId,
            changedByStaffId: staff.staffId,
            reason: ticket.ownerStaffId === null ? 'FIRST_STAFF_REPLY' : 'STAFF_REPLY_TAKEOVER',
          },
        });
      }
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          ownerStaffId: staff.staffId,
          firstRespondedAt: ticket.firstRespondedAt ?? now,
          lastRespondedAt: now,
          nextResponseDueAt: new Date(now.getTime() + NEXT_RESPONSE_SLA_MS),
        },
      });
      await tx.workItem.update({
        where: { id: ticket.workItemId },
        data: {
          assignedToStaffId: staff.staffId,
          assignedAt: ownerChanged ? now : undefined,
          startedAt: now,
          status: 'WAITING_CUSTOMER',
          dueAt: new Date(now.getTime() + NEXT_RESPONSE_SLA_MS),
        },
      });
      return tx.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, include: TICKET_INCLUDE });
    });
    await this.audit.record({
      actor: staff.staffId,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: ownerChanged ? 'SUPPORT_TICKET_REPLIED_AND_OWNER_CHANGED' : 'SUPPORT_TICKET_REPLIED',
      entity: 'SupportTicket',
      entityId: ticketId,
      after: { previousOwnerStaffId: ticket.ownerStaffId, ownerStaffId: staff.staffId },
    });
    return toDto(row);
  }

  async close(staff: AuthenticatedStaff, ticketId: string, resolutionNote: string): Promise<SupportTicketDto> {
    const ticket = await this.database.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true, workItemId: true, closedAt: true },
    });
    if (ticket === null) throw DomainErrors.notFound(`support ticket ${ticketId}`);
    if (ticket.closedAt !== null) return this.getForStaff(ticketId);

    const now = new Date();
    const row = await this.database.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id: ticketId }, data: { closedAt: now, nextResponseDueAt: now } });
      await tx.workItem.update({
        where: { id: ticket.workItemId },
        data: { status: 'COMPLETED', completedAt: now, resolutionNote: resolutionNote.trim() },
      });
      return tx.supportTicket.findUniqueOrThrow({ where: { id: ticketId }, include: TICKET_INCLUDE });
    });
    await this.audit.record({
      actor: staff.staffId,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: 'SUPPORT_TICKET_CLOSED',
      entity: 'SupportTicket',
      entityId: ticketId,
      after: { resolutionNote: resolutionNote.trim() },
    });
    return toDto(row);
  }
}

function customerName(row: TicketRow): string | null {
  const profile = row.workItem.customer?.profile;
  const name = [profile?.firstName, profile?.lastName].filter(Boolean).join(' ').trim();
  return name || null;
}

function toDto(row: TicketRow): SupportTicketDto {
  const now = Date.now();
  const awaitingStaff = row.workItem.status === 'UNASSIGNED' || row.workItem.status === 'IN_PROGRESS';
  return {
    id: row.id,
    workItemId: row.workItemId,
    code: row.workItem.code,
    subject: row.workItem.title,
    status: row.workItem.status,
    customerId: row.workItem.customerId ?? '',
    customerName: customerName(row),
    customerCode: row.workItem.customer?.customerCode ?? '',
    orderId: row.workItem.orderId,
    orderNumber: row.workItem.order?.orderNumber ?? null,
    ownerStaffId: row.ownerStaffId,
    ownerStaffName: row.owner?.fullName ?? null,
    createdAt: row.createdAt.toISOString(),
    firstResponseDueAt: row.firstResponseDueAt.toISOString(),
    nextResponseDueAt: row.nextResponseDueAt.toISOString(),
    firstRespondedAt: row.firstRespondedAt?.toISOString() ?? null,
    lastRespondedAt: row.lastRespondedAt?.toISOString() ?? null,
    firstResponseBreached: row.firstRespondedAt === null
      ? now > row.firstResponseDueAt.getTime()
      : row.firstRespondedAt.getTime() > row.firstResponseDueAt.getTime(),
    responseBreached: awaitingStaff && now > row.nextResponseDueAt.getTime(),
    resolutionNote: row.workItem.resolutionNote,
    messages: row.messages.map((message) => ({
      id: message.id,
      authorType: message.authorType,
      authorName: message.authorType === 'CUSTOMER' ? (customerName(row) ?? 'مشتری') : (message.staff?.fullName ?? 'کارشناس پشتیبانی'),
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    })),
    ownershipHistory: row.ownershipEvents.map((event) => ({
      id: event.id,
      previousOwnerName: event.previousStaff?.fullName ?? null,
      newOwnerName: event.newStaff.fullName,
      changedByName: event.changedBy.fullName,
      reason: event.reason,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
