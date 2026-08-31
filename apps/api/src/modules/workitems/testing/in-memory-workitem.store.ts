import type { QueueKey, WorkItemStatus } from '@barat/contracts';

import {
  ACTIVE_OPERATOR_STATUSES,
  type ClaimingStaff,
  type CreateWorkItemRecord,
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

  async findByOrderId(orderId: string): Promise<WorkItemSummary | null> {
    // Mirrors the real query: the *lock-holding* item, not an escalation.
    return [...this.rows.values()].find((row) => row.activeOrderKey === orderId) ?? null;
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
    take: number;
  }): Promise<readonly WorkItemSummary[]> {
    return [...this.rows.values()]
      .filter((row) => filter.queueKey === undefined || row.queueKey === filter.queueKey)
      .filter((row) => filter.status === undefined || row.status === filter.status)
      .filter(
        (row) =>
          filter.assignedToStaffId === undefined || row.assignedToStaffId === filter.assignedToStaffId,
      )
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
}
