import { Injectable } from '@nestjs/common';
import { prisma, type Prisma } from '@barat/database';
import type { QueueKey, WorkItemStatus, WorkItemType } from '@barat/contracts';

import {
  type ClaimingStaff,
  type CreateWorkItemRecord,
  type OrderQuoteTarget,
  type WorkItemStore,
  type WorkItemSummary,
} from './workitems.types';

/**
 * The projection every read goes through.
 *
 * `payload` and `resolutionNote` are deliberately absent: nothing that could
 * carry a supplier response, a code or a PIN leaves the store.
 */
const WORK_ITEM_SELECT = {
  id: true,
  code: true,
  orderId: true,
  customerId: true,
  type: true,
  status: true,
  priority: true,
  assignedToStaffId: true,
  assignedAt: true,
  startedAt: true,
  completedAt: true,
  dueAt: true,
  slaBreachedAt: true,
  title: true,
  description: true,
  createdAt: true,
  queue: { select: { key: true } },
  assignedTo: { select: { fullName: true } },
} satisfies Prisma.WorkItemSelect;

type SelectedWorkItem = Prisma.WorkItemGetPayload<{ select: typeof WORK_ITEM_SELECT }>;

function toSummary(row: SelectedWorkItem): WorkItemSummary {
  return {
    id: row.id,
    code: row.code,
    orderId: row.orderId,
    customerId: row.customerId,
    queueKey: row.queue.key as QueueKey,
    type: row.type as WorkItemType,
    status: row.status as WorkItemStatus,
    priority: row.priority,
    assignedToStaffId: row.assignedToStaffId,
    assignedToStaffName: row.assignedTo?.fullName ?? null,
    assignedAt: row.assignedAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    dueAt: row.dueAt,
    slaBreachedAt: row.slaBreachedAt,
    title: row.title,
    description: row.description,
    createdAt: row.createdAt,
  };
}

@Injectable()
export class PrismaWorkItemStore implements WorkItemStore {
  private readonly db: typeof prisma;

  constructor() {
    this.db = prisma;
  }

  async findByOrderId(orderId: string): Promise<WorkItemSummary | null> {
    const row = await this.db.workItem.findFirst({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: WORK_ITEM_SELECT,
    });
    return row ? toSummary(row) : null;
  }

  /**
   * Reads what the order was placed for.
   *
   * Only the two discriminating columns are selected: this is a routing
   * decision, not a reason to pull a quote — let alone its snapshot — into the
   * work-item module.
   */
  async findOrderQuoteTarget(orderId: string): Promise<OrderQuoteTarget | null> {
    const row = await this.db.order.findUnique({
      where: { id: orderId },
      select: { quote: { select: { skuId: true, serviceId: true } } },
    });
    if (row === null) {
      return null;
    }
    return row.quote.serviceId === null ? 'SKU' : 'SERVICE';
  }

  async findByCode(code: string): Promise<WorkItemSummary | null> {
    const row = await this.db.workItem.findUnique({ where: { code }, select: WORK_ITEM_SELECT });
    return row ? toSummary(row) : null;
  }

  async findById(workItemId: string): Promise<WorkItemSummary | null> {
    const row = await this.db.workItem.findUnique({
      where: { id: workItemId },
      select: WORK_ITEM_SELECT,
    });
    return row ? toSummary(row) : null;
  }

  async list(filter: {
    queueKey?: QueueKey;
    status?: WorkItemStatus;
    assignedToStaffId?: string;
    take: number;
  }): Promise<readonly WorkItemSummary[]> {
    const rows = await this.db.workItem.findMany({
      where: {
        ...(filter.queueKey === undefined ? {} : { queue: { key: filter.queueKey } }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.assignedToStaffId === undefined
          ? {}
          : { assignedToStaffId: filter.assignedToStaffId }),
      },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
      take: filter.take,
      select: WORK_ITEM_SELECT,
    });
    return rows.map(toSummary);
  }

  /**
   * Creates the work item and sets `activeOrderKey = orderId`.
   *
   * That column carries a UNIQUE constraint, so a second live item for the same
   * order is rejected by PostgreSQL itself even if two paid callbacks race past
   * the application-level check. The unique violation is surfaced to the caller,
   * which resolves it by returning the existing item.
   */
  async create(record: CreateWorkItemRecord): Promise<WorkItemSummary> {
    const queue = await this.ensureQueue(record.queueKey);

    const row = await this.db.workItem.create({
      data: {
        code: record.code,
        orderId: record.orderId,
        customerId: record.customerId,
        queueId: queue.id,
        type: record.type,
        status: 'UNASSIGNED',
        priority: record.priority,
        activeOrderKey: record.holdsOrderLock ? record.orderId : null,
        title: record.title,
        description: record.description,
        dueAt: record.dueAt,
        ...(record.payload === null
          ? {}
          : { payload: record.payload as Prisma.InputJsonValue }),
      },
      select: WORK_ITEM_SELECT,
    });
    return toSummary(row);
  }

  async findStaff(staffId: string): Promise<ClaimingStaff | null> {
    const row = await this.db.staffUser.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, isActive: true },
    });
    return row ? { id: row.id, role: row.role, isActive: row.isActive } : null;
  }

  async isQueueMember(queueKey: QueueKey, staffId: string): Promise<boolean> {
    const membership = await this.db.queueMembership.findFirst({
      where: { staffUserId: staffId, queue: { key: queueKey } },
      select: { id: true },
    });
    return membership !== null;
  }

  async countActiveForStaff(staffId: string): Promise<number> {
    return this.db.workItem.count({
      where: {
        assignedToStaffId: staffId,
        status: { in: ['ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SUPPLIER', 'NEED_REVIEW'] },
      },
    });
  }

  /**
   * The single atomic conditional update that decides a contested claim.
   *
   * `updateMany` compiles to one `UPDATE ... WHERE id = ? AND status =
   * 'UNASSIGNED' AND assignedToStaffId IS NULL`. PostgreSQL serialises the two
   * concurrent statements on the row lock, so the loser observes the already
   * changed row and matches zero rows. Exactly one caller gets `count === 1`.
   */
  async claimIfUnassigned(workItemId: string, staffId: string, at: Date): Promise<boolean> {
    const result = await this.db.workItem.updateMany({
      where: { id: workItemId, status: 'UNASSIGNED', assignedToStaffId: null },
      data: { status: 'ASSIGNED', assignedToStaffId: staffId, assignedAt: at },
    });
    return result.count === 1;
  }

  async transitionIfOwned(input: {
    workItemId: string;
    staffId: string;
    from: readonly WorkItemStatus[];
    to: WorkItemStatus;
    at: Date;
    resolutionNote?: string;
    releaseOrderLock: boolean;
  }): Promise<boolean> {
    const result = await this.db.workItem.updateMany({
      where: {
        id: input.workItemId,
        assignedToStaffId: input.staffId,
        status: { in: [...input.from] },
      },
      data: {
        status: input.to,
        ...(input.to === 'IN_PROGRESS' ? { startedAt: input.at } : {}),
        ...(input.releaseOrderLock ? { activeOrderKey: null, completedAt: input.at } : {}),
        ...(input.resolutionNote === undefined ? {} : { resolutionNote: input.resolutionNote }),
      },
    });
    return result.count === 1;
  }

  private async ensureQueue(key: QueueKey): Promise<{ id: string }> {
    return this.db.queue.upsert({
      where: { key },
      create: { key, name: key, description: 'Created automatically on first use' },
      update: {},
      select: { id: true },
    });
  }
}
