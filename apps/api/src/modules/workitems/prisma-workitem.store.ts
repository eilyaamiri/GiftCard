import { Injectable } from '@nestjs/common';
import { prisma, type Prisma } from '@barat/database';
import type { QueueKey, WorkItemStatus, WorkItemType } from '@barat/contracts';

import {
  DEFAULT_QUEUE_BY_WORK_ITEM_TYPE,
  DEFAULT_TITLE_BY_WORK_ITEM_TYPE,
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
   * Only the three discriminating columns are selected: this is a routing
   * decision, not a reason to pull a quote — let alone its snapshot — into the
   * work-item module.
   *
   * `topUpOfferId` is tested FIRST, and that order matters. The column is
   * additive and nullable, so during a rolling deploy every pre-existing row
   * reads as null and keeps its old behaviour. A top-up row, however, must never
   * be mistaken for a SKU: the SKU branch is what creates the gift-card
   * `MANUAL_GIFT_CARD_FULFILLMENT` task, and a top-up order must produce no task
   * at all. Checking the top-up column first makes that impossible regardless of
   * how the other two columns are populated.
   */
  async findOrderQuoteTarget(orderId: string): Promise<OrderQuoteTarget | null> {
    const row = await this.db.order.findUnique({
      where: { id: orderId },
      select: { quote: { select: { skuId: true, serviceId: true, topUpOfferId: true } } },
    });
    if (row === null) {
      return null;
    }
    if (row.quote.topUpOfferId !== null) {
      return 'TOP_UP';
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
    orderId?: string;
    take: number;
  }): Promise<readonly WorkItemSummary[]> {
    const rows = await this.db.workItem.findMany({
      where: {
        ...(filter.queueKey === undefined ? {} : { queue: { key: filter.queueKey } }),
        ...(filter.status === undefined ? {} : { status: filter.status }),
        ...(filter.assignedToStaffId === undefined
          ? {}
          : { assignedToStaffId: filter.assignedToStaffId }),
        ...(filter.orderId === undefined ? {} : { orderId: filter.orderId }),
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
      // Deactivating a queue stops new operator claims without hiding its
      // existing work items from managers or disrupting assigned work.
      where: { staffUserId: staffId, queue: { key: queueKey, isActive: true } },
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

  /**
   * The same conditional-update trick, used when automation finished the job.
   *
   * The `WHERE` clause still pins `UNASSIGNED` and a null claimant, so an
   * operator who claimed the item a millisecond earlier keeps it: this update
   * matches zero rows and the caller learns it lost. Releasing `activeOrderKey`
   * matters as much as the status — leave it set and the order can never get a
   * second work item if something later needs one.
   */
  async completeUnassignedBySystem(input: {
    workItemId: string;
    at: Date;
    resolutionNote: string;
  }): Promise<boolean> {
    const result = await this.db.workItem.updateMany({
      where: { id: input.workItemId, status: 'UNASSIGNED', assignedToStaffId: null },
      data: {
        status: 'COMPLETED',
        activeOrderKey: null,
        completedAt: input.at,
        resolutionNote: input.resolutionNote,
      },
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

  async markDeliveredForReview(input: {
    workItemId: string;
    title: string;
    description: string;
    priority: number;
  }): Promise<boolean> {
    const result = await this.db.workItem.updateMany({
      where: { id: input.workItemId, status: 'UNASSIGNED', assignedToStaffId: null },
      data: { title: input.title, description: input.description, priority: input.priority },
    });
    return result.count === 1;
  }

  async retypeIfOwned(input: {
    workItemId: string;
    staffId: string;
    from: readonly WorkItemStatus[];
    type: WorkItemType;
    title: string;
    note: string;
    at: Date;
  }): Promise<boolean> {
    /* The destination queue comes from the shared type→queue map, never from a
     * caller-supplied id: a retype that landed an item in the wrong queue would
     * hide it from the only people allowed to action it. */
    const queue = await this.ensureQueue(DEFAULT_QUEUE_BY_WORK_ITEM_TYPE[input.type]);

    const result = await this.db.workItem.updateMany({
      where: {
        id: input.workItemId,
        assignedToStaffId: input.staffId,
        status: { in: [...input.from] },
      },
      data: {
        type: input.type,
        queueId: queue.id,
        title: input.title,
        /* Not `resolutionNote`: the item is not resolved, it changed job. The
         * note is why, and it has to survive into the refund queue. */
        description: input.note,
        updatedAt: input.at,
      },
    });
    return result.count === 1;
  }

  async convertToRefundIfOwned(input: {
    workItemId: string;
    staffId: string;
    staffRole: string;
    from: readonly WorkItemStatus[];
    allowedTypes: readonly WorkItemType[];
    note: string;
    amountIrr: bigint;
    at: Date;
  }): Promise<{ changed: boolean; orderId: string | null; refundId?: string }> {
    const queue = await this.ensureQueue(DEFAULT_QUEUE_BY_WORK_ITEM_TYPE['REFUND_REVIEW']);

    return this.db.$transaction(async (tx) => {
      /* Read the work item while holding the row lock. */
      const item = await tx.workItem.findUnique({
        where: { id: input.workItemId },
        select: { orderId: true, assignedToStaffId: true, status: true, type: true },
      });
      if (
        item === null ||
        item.assignedToStaffId !== input.staffId ||
        !input.from.includes(item.status as WorkItemStatus) ||
        !input.allowedTypes.includes(item.type as WorkItemType)
      ) {
        return { changed: false, orderId: item?.orderId ?? null };
      }
      if (item.orderId === null) {
        return { changed: false, orderId: null };
      }

      /* Read the order to verify the amount ceiling. */
      const order = await tx.order.findUnique({
        where: { id: item.orderId },
        select: { status: true, totalAmountIrr: true },
      });
      if (order === null) {
        return { changed: false, orderId: item.orderId };
      }
      if (order.status !== 'REVIEW_REQUIRED') {
        return { changed: false, orderId: item.orderId };
      }
      if (input.amountIrr <= 0n || input.amountIrr > order.totalAmountIrr) {
        throw new Error('REFUND_AMOUNT_INVALID');
      }

      /* Move the order to REFUND_PENDING. */
      await tx.order.updateMany({
        where: { id: item.orderId, status: 'REVIEW_REQUIRED' },
        data: { status: 'REFUND_PENDING' },
      });

      /* Retype the work item. */
      await tx.workItem.update({
        where: { id: input.workItemId },
        data: {
          type: 'REFUND_REVIEW',
          queueId: queue.id,
          title: DEFAULT_TITLE_BY_WORK_ITEM_TYPE['REFUND_REVIEW'],
          description: input.note,
          updatedAt: input.at,
        },
      });

      /* Create the refund record. */
      const refund = await tx.refund.create({
        data: {
          orderId: item.orderId,
          amountIrr: input.amountIrr,
          reason: input.note,
          status: 'REQUESTED',
          requestedByStaffId: input.staffId,
        },
      });

      /* Audit the order transition. */
      await tx.auditLog.create({
        data: {
          actor: input.staffId,
          actorType: 'STAFF',
          actorRole: input.staffRole,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'Order',
          entityId: item.orderId,
          before: { status: 'REVIEW_REQUIRED' } as Prisma.InputJsonValue,
          after: { status: 'REFUND_PENDING', reason: 'CONVERTED_TO_REFUND', refundId: refund.id } as Prisma.InputJsonValue,
        },
      });

      return { changed: true, orderId: item.orderId, refundId: refund.id };
    }).catch((err: unknown) => {
      if (err instanceof Error && err.message === 'REFUND_AMOUNT_INVALID') {
        return { changed: false, orderId: null };
      }
      throw err;
    });
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
