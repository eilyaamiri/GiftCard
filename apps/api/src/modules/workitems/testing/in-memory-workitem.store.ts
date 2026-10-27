import type { QueueKey, WorkItemStatus, WorkItemType } from '@barat/contracts';

import {
  ACTIVE_OPERATOR_STATUSES,
  DEFAULT_QUEUE_BY_WORK_ITEM_TYPE,
  DEFAULT_TITLE_BY_WORK_ITEM_TYPE,
  MANAGER_REFUND_ROLES,
  type ClaimingStaff,
  type ConvertToRefundResult,
  type CreateWorkItemRecord,
  type OrderQuoteTarget,
  type RefundCardDisposition,
  type WorkItemStore,
  type WorkItemSummary,
} from '../workitems.types';

/**
 * An in-memory `WorkItemStore` that reproduces the two database guarantees the
 * service depends on:
 *
 *   1. `activeOrderKey` is UNIQUE — at most one *lock-holding* work item per
 *      order — and a violation throws a Prisma-shaped `P2002`, because the
 *      service resolves that error into the winning row rather than surfacing it.
 *   2. `claimIfUnassigned` is a single conditional update whose affected-row
 *      count decides the winner. Nothing here re-reads and re-decides, so a
 *      concurrent claim in a test fails for the same reason it would in Postgres.
 */

interface WorkItemRow extends WorkItemSummary {
  activeOrderKey: string | null;
}

/** Shape-compatible with `Prisma.PrismaClientKnownRequestError` for P2002. */
class UniqueConstraintError extends Error {
  readonly code = 'P2002';
  readonly clientVersion = 'in-memory';
  readonly meta: { target: string[] };

  constructor(target: string) {
    super('Unique constraint failed');
    this.name = 'PrismaClientKnownRequestError';
    this.meta = { target: [target] };
  }
}

export class InMemoryWorkItemStore implements WorkItemStore {
  readonly rows = new Map<string, WorkItemRow>();
  readonly staff = new Map<string, ClaimingStaff>();
  readonly queueMembers = new Map<string, Set<string>>();
  /** Queues an admin has closed to new claims; every other queue is open. */
  readonly inactiveQueues = new Set<QueueKey>();
  /** Orders whose quote points at an international service rather than a SKU. */
  readonly serviceOrders = new Set<string>();

  /** Set to fail the next N `create` calls with P2002, to force the race path. */
  failNextCreates = 0;

  private sequence = 0;

  constructor(staff: readonly ClaimingStaff[] = []) {
    for (const member of staff) {
      this.staff.set(member.id, member);
    }
  }

  addStaff(member: ClaimingStaff): void {
    this.staff.set(member.id, member);
  }

  addQueueMember(queueKey: QueueKey, staffId: string): void {
    const members = this.queueMembers.get(queueKey) ?? new Set<string>();
    members.add(staffId);
    this.queueMembers.set(queueKey, members);
  }

  /** Mirrors the `Queue.isActive` column an admin toggles from Settings. */
  setQueueActive(queueKey: QueueKey, isActive: boolean): void {
    if (isActive) {
      this.inactiveQueues.delete(queueKey);
    } else {
      this.inactiveQueues.add(queueKey);
    }
  }

  async findByOrderId(orderId: string): Promise<WorkItemSummary | null> {
    // Mirrors the real query: the *lock-holding* item, not an escalation.
    return [...this.rows.values()].find((row) => row.activeOrderKey === orderId) ?? null;
  }

  /** Registers an order as an international-service purchase. */
  addServiceOrder(orderId: string): void {
    this.serviceOrders.add(orderId);
  }

  async findOrderQuoteTarget(orderId: string): Promise<OrderQuoteTarget | null> {
    return this.serviceOrders.has(orderId) ? 'SERVICE' : 'SKU';
  }

  async findById(workItemId: string): Promise<WorkItemSummary | null> {
    return this.rows.get(workItemId) ?? null;
  }

  async findByCode(code: string): Promise<WorkItemSummary | null> {
    return [...this.rows.values()].find((row) => row.code === code) ?? null;
  }

  async list(filter: {
    queueKey?: QueueKey;
    status?: WorkItemStatus;
    assignedToStaffId?: string;
    orderId?: string;
    take: number;
  }): Promise<readonly WorkItemSummary[]> {
    return [...this.rows.values()]
      .filter((row) => filter.queueKey === undefined || row.queueKey === filter.queueKey)
      .filter((row) => filter.status === undefined || row.status === filter.status)
      .filter(
        (row) =>
          filter.assignedToStaffId === undefined || row.assignedToStaffId === filter.assignedToStaffId,
      )
      .filter((row) => filter.orderId === undefined || row.orderId === filter.orderId)
      .slice(0, filter.take);
  }

  async create(record: CreateWorkItemRecord): Promise<WorkItemSummary> {
    if (this.failNextCreates > 0) {
      this.failNextCreates -= 1;
      throw new UniqueConstraintError('activeOrderKey');
    }

    const activeOrderKey = record.holdsOrderLock ? record.orderId : null;

    if (activeOrderKey !== null) {
      const clash = [...this.rows.values()].some((row) => row.activeOrderKey === activeOrderKey);
      if (clash) {
        throw new UniqueConstraintError('activeOrderKey');
      }
    }
    if ([...this.rows.values()].some((row) => row.code === record.code)) {
      throw new UniqueConstraintError('code');
    }

    this.sequence += 1;
    const row: WorkItemRow = {
      id: `wi-${String(this.sequence)}`,
      code: record.code,
      orderId: record.orderId,
      customerId: record.customerId,
      queueKey: record.queueKey,
      type: record.type,
      status: 'UNASSIGNED',
      priority: record.priority,
      assignedToStaffId: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      dueAt: record.dueAt,
      title: record.title,
      description: record.description,
      createdAt: new Date(),
      activeOrderKey,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findStaff(staffId: string): Promise<ClaimingStaff | null> {
    return this.staff.get(staffId) ?? null;
  }

  async isQueueMember(queueKey: QueueKey, staffId: string): Promise<boolean> {
    // The Prisma store joins through `queue: { isActive: true }`, so a closed
    // queue has no members to claim from. Kept identical here on purpose: the
    // two implementations of this port must not answer the same call
    // differently, or the tests stop covering production behaviour.
    if (this.inactiveQueues.has(queueKey)) {
      return false;
    }
    return this.queueMembers.get(queueKey)?.has(staffId) ?? false;
  }

  async countActiveForStaff(staffId: string): Promise<number> {
    return [...this.rows.values()].filter(
      (row) => row.assignedToStaffId === staffId && ACTIVE_OPERATOR_STATUSES.includes(row.status),
    ).length;
  }

  /**
   * The atomic claim.
   *
   * This is one synchronous check-and-set with no `await` inside it, which is the
   * in-process equivalent of `UPDATE ... WHERE assignedToStaffId IS NULL`: no
   * other continuation can interleave between the test and the write.
   */
  async claimIfUnassigned(workItemId: string, staffId: string, at: Date): Promise<boolean> {
    const row = this.rows.get(workItemId);
    if (row === undefined || row.assignedToStaffId !== null || row.status !== 'UNASSIGNED') {
      return false;
    }
    this.rows.set(workItemId, {
      ...row,
      assignedToStaffId: staffId,
      assignedAt: at,
      status: 'ASSIGNED',
    });
    return true;
  }

  /**
   * The system close, kept as narrow here as the SQL is in Postgres.
   *
   * A claimed item is left untouched, so a test can race a claim against an
   * automated purchase and see the operator keep the work.
   */
  async completeUnassignedBySystem(input: {
    workItemId: string;
    at: Date;
    resolutionNote: string;
  }): Promise<boolean> {
    const row = this.rows.get(input.workItemId);
    if (row === undefined || row.assignedToStaffId !== null || row.status !== 'UNASSIGNED') {
      return false;
    }
    this.rows.set(input.workItemId, {
      ...row,
      status: 'COMPLETED',
      activeOrderKey: null,
      completedAt: input.at,
    });
    return true;
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
    const row = this.rows.get(input.workItemId);
    if (
      row === undefined ||
      row.assignedToStaffId !== input.staffId ||
      !input.from.includes(row.status)
    ) {
      return false;
    }
    this.rows.set(input.workItemId, {
      ...row,
      status: input.to,
      ...(input.to === 'IN_PROGRESS' && row.startedAt === null ? { startedAt: input.at } : {}),
      ...(input.releaseOrderLock ? { activeOrderKey: null, completedAt: input.at } : {}),
    });
    return true;
  }

  async markDeliveredForReview(input: {
    workItemId: string;
    title: string;
    description: string;
    priority: number;
  }): Promise<boolean> {
    const row = this.rows.get(input.workItemId);
    if (row === undefined || row.assignedToStaffId !== null || row.status !== 'UNASSIGNED') {
      return false;
    }
    this.rows.set(input.workItemId, {
      ...row,
      title: input.title,
      description: input.description,
      priority: input.priority,
    });
    return true;
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
    const row = this.rows.get(input.workItemId);
    if (
      row === undefined ||
      row.assignedToStaffId !== input.staffId ||
      !input.from.includes(row.status)
    ) {
      return false;
    }
    this.rows.set(input.workItemId, {
      ...row,
      type: input.type,
      queueKey: DEFAULT_QUEUE_BY_WORK_ITEM_TYPE[input.type],
      title: input.title,
      description: input.note,
    });
    return true;
  }

  /** Track orders and their status for convert-to-refund tests. */
  readonly orders = new Map<string, { status: string; totalAmountIrr: bigint }>();

  /** The live card's delivery status per order, when one exists (FUL-4). */
  readonly assetStatuses = new Map<string, string>();

  /** Track refunds created by convertToRefundIfOwned. */
  readonly refunds = new Map<string, { orderId: string; amountIrr: bigint; reason: string; status: string }>();

  private refundSequence = 0;

  async convertToRefundIfOwned(input: {
    workItemId: string;
    staffId: string;
    staffRole: string;
    from: readonly WorkItemStatus[];
    allowedTypes: readonly WorkItemType[];
    note: string;
    amountIrr: bigint;
    cardDisposition?: RefundCardDisposition;
    at: Date;
  }): Promise<ConvertToRefundResult> {
    const row = this.rows.get(input.workItemId);
    if (
      row === undefined ||
      row.assignedToStaffId !== input.staffId ||
      !input.from.includes(row.status) ||
      !input.allowedTypes.includes(row.type)
    ) {
      return { changed: false, orderId: row?.orderId ?? null };
    }
    if (row.orderId === null) {
      return { changed: false, orderId: null };
    }

    const order = this.orders.get(row.orderId);
    if (!order || order.status !== 'REVIEW_REQUIRED') {
      return { changed: false, orderId: row.orderId };
    }
    if (input.amountIrr <= 0n || input.amountIrr > order.totalAmountIrr) {
      return { changed: false, orderId: row.orderId };
    }
    const asset = this.assetStatuses.get(row.orderId);
    if (asset === 'SENDING' || asset === 'SENT') {
      return { changed: false, orderId: row.orderId, blockedBy: 'ASSET_SENT' };
    }
    if (asset !== undefined && (!MANAGER_REFUND_ROLES.has(input.staffRole) || input.cardDisposition === undefined)) {
      return { changed: false, orderId: row.orderId, blockedBy: 'ASSET_NEEDS_MANAGER' };
    }

    order.status = 'REFUND_PENDING';
    this.rows.set(input.workItemId, {
      ...row,
      type: 'REFUND_REVIEW',
      queueKey: DEFAULT_QUEUE_BY_WORK_ITEM_TYPE['REFUND_REVIEW'],
      title: DEFAULT_TITLE_BY_WORK_ITEM_TYPE['REFUND_REVIEW'],
      description: input.note,
    });

    this.refundSequence += 1;
    const refundId = `refund-${String(this.refundSequence)}`;
    this.refunds.set(refundId, {
      orderId: row.orderId,
      amountIrr: input.amountIrr,
      reason: input.note,
      status: 'REQUESTED',
    });

    return { changed: true, orderId: row.orderId, refundId };
  }
}
