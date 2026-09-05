import { Inject, Injectable } from '@nestjs/common';
import type { QueueKey, WorkItemStatus, WorkItemType } from '@barat/contracts';
import { nanoid } from 'nanoid';

import { AuditService } from '../audit/audit.service';
import { isUniqueConstraintViolation } from './prisma-errors';
import { DomainErrors } from '../../common/errors/domain.exception';
import {
  ACTIVE_OPERATOR_STATUSES,
  CLAIMING_ROLES,
  DEFAULT_QUEUE_BY_WORK_ITEM_TYPE,
  DEFAULT_TITLE_BY_WORK_ITEM_TYPE,
  MAX_CONCURRENT_WORK_ITEMS_PER_OPERATOR,
  WORK_ITEM_STORE,
  type EscalationInput,
  type FulfillmentTrigger,
  type FulfillmentTriggerInput,
  type WorkItemEscalator,
  type WorkItemStore,
  type WorkItemSummary,
} from './workitems.types';

const CLAIMING_ROLE_SET: ReadonlySet<string> = new Set<string>(CLAIMING_ROLES);

/**
 * Work-item lifecycle.
 *
 * Two invariants are enforced here and nowhere else:
 *
 *  1. A paid order gets EXACTLY ONE work item. `activeOrderKey` is unique in the
 *     database, so a race loses with a unique violation, which is then resolved
 *     into the winner's item rather than into a duplicate.
 *  2. A work item is claimed by EXACTLY ONE operator. The claim is an atomic
 *     conditional update whose affected-row count is asserted — never a read
 *     followed by a write, which is precisely how two operators end up holding
 *     the same customer's gift card.
 */
@Injectable()
export class WorkItemsService implements FulfillmentTrigger, WorkItemEscalator {
  constructor(
    @Inject(WORK_ITEM_STORE) private readonly store: WorkItemStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /* ------------------------------------------------------------ creation */

  /**
   * The `FulfillmentTrigger` port. B4 calls this once, AFTER its payment
   * transaction has committed — never inside it, or a rolled-back payment would
   * leave an operator holding work for an order that was never paid.
   */
  async onOrderPaid(input: FulfillmentTriggerInput): Promise<WorkItemSummary> {
    if (!input.orderId.trim()) {
      throw DomainErrors.validation([{ path: 'orderId', message: 'orderId is required' }]);
    }

    const existing = await this.store.findByOrderId(input.orderId);
    if (existing) {
      return existing;
    }

    const type: WorkItemType = input.workItemType ?? (await this.typeForOrder(input.orderId));
    const queueKey: QueueKey = input.queueKey ?? DEFAULT_QUEUE_BY_WORK_ITEM_TYPE[type];

    try {
      const created = await this.store.create({
        code: `WI-${nanoid(14)}`,
        orderId: input.orderId,
        customerId: input.customerId ?? null,
        queueKey,
        type,
        priority: input.priority ?? 100,
        title: input.title ?? DEFAULT_TITLE_BY_WORK_ITEM_TYPE[type],
        description: input.description ?? null,
        dueAt: input.dueAt ?? null,
        payload: input.payload ?? null,
        holdsOrderLock: true,
      });

      await this.audit.record({
        actor: 'system:fulfillment-trigger',
        actorType: 'SYSTEM',
        action: 'WORK_ITEM_CREATED',
        entity: 'WorkItem',
        entityId: created.id,
        after: { orderId: created.orderId, type: created.type, queueKey: created.queueKey },
      });

      return created;
    } catch (error) {
      /*
       * The unique `activeOrderKey` (or `code`) rejected a concurrent creation.
       * The correct answer is the item that won, not an error: the caller is a
       * payment callback that may legitimately arrive five times.
       */
      if (isUniqueConstraintViolation(error)) {
        const winner = await this.store.findByOrderId(input.orderId);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /**
   * What kind of work a paid order actually needs.
   *
   * The trigger's caller is a payment callback: it knows money settled, not what
   * was bought. Defaulting to `MANUAL_GIFT_CARD_FULFILLMENT` therefore put every
   * international-payment order in the gift-card queue, under a gift-card title,
   * with a gift-card checklist — so the answer is read from the order's own
   * immutable quote instead. An order whose quote cannot be resolved keeps the
   * historical default rather than blocking fulfillment on a lookup.
   */
  private async typeForOrder(orderId: string): Promise<WorkItemType> {
    const target = await this.store.findOrderQuoteTarget(orderId);
    return target === 'SERVICE' ? 'INTERNATIONAL_PAYMENT' : 'MANUAL_GIFT_CARD_FULFILLMENT';
  }

  /**
   * Raises a secondary work item for an order that already has one.
   *
   * Used for escalations that must not replace the fulfillment task: an UNKNOWN
   * supplier outcome, a customer-information request, a supplier follow-up. It
   * deliberately does NOT take the order lock — `onOrderPaid` owns that — so the
   * unique `activeOrderKey` stays free for the one task that represents the order.
   *
   * Idempotency comes from a caller-supplied deterministic `code`: replaying the
   * same supplier callback creates one escalation, not five.
   */
  async openEscalation(input: EscalationInput): Promise<WorkItemSummary> {
    const existing = await this.store.findByCode(input.code);
    if (existing) {
      return existing;
    }

    const queueKey: QueueKey = input.queueKey ?? DEFAULT_QUEUE_BY_WORK_ITEM_TYPE[input.type];

    try {
      const created = await this.store.create({
        code: input.code,
        orderId: input.orderId,
        customerId: input.customerId ?? null,
        queueKey,
        type: input.type,
        priority: input.priority ?? 50,
        title: input.title ?? DEFAULT_TITLE_BY_WORK_ITEM_TYPE[input.type],
        description: input.description ?? null,
        dueAt: null,
        payload: input.payload ?? null,
        holdsOrderLock: false,
      });

      await this.audit.record({
        actor: input.actor ?? 'system:escalation',
        actorType: 'SYSTEM',
        action: 'WORK_ITEM_ESCALATION_OPENED',
        entity: 'WorkItem',
        entityId: created.id,
        after: {
          orderId: created.orderId,
          type: created.type,
          queueKey: created.queueKey,
          code: created.code,
        },
      });

      return created;
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        const winner = await this.store.findByCode(input.code);
        if (winner) {
          return winner;
        }
      }
      throw error;
    }
  }

  /* --------------------------------------------------------------- claim */

  /**
   * Claim a work item for an operator.
   *
   * Capacity is checked first, then the atomic claim decides the winner. A lost
   * race is a 409, never a silent second assignment.
   */
  async claim(workItemId: string, staffId: string): Promise<WorkItemSummary> {
    const staff = await this.store.findStaff(staffId);
    if (!staff || !staff.isActive || !CLAIMING_ROLE_SET.has(staff.role)) {
      throw DomainErrors.forbidden('Staff user may not claim work items');
    }

    const item = await this.store.findById(workItemId);
    if (!item) {
      throw DomainErrors.notFound('WorkItem');
    }
    if (item.status !== 'UNASSIGNED' || item.assignedToStaffId !== null) {
      throw DomainErrors.conflict(
        'این کار قبلاً توسط اپراتور دیگری برداشته شده است.',
        `WorkItem ${workItemId} is already claimed`,
      );
    }

    if (staff.role === 'OPERATOR') {
      const isMember = await this.store.isQueueMember(item.queueKey, staffId);
      if (!isMember) {
        throw DomainErrors.forbidden('Operator is not a member of this queue');
      }
    }

    const activeCount = await this.store.countActiveForStaff(staffId);
    if (activeCount >= MAX_CONCURRENT_WORK_ITEMS_PER_OPERATOR) {
      throw DomainErrors.conflict(
        'به حداکثر تعداد کار هم‌زمان رسیده‌اید. ابتدا یکی از کارهای باز را ببندید.',
        `Operator holds ${String(activeCount)} active work items`,
      );
    }

    const won = await this.store.claimIfUnassigned(workItemId, staffId, new Date());
    if (!won) {
      throw DomainErrors.conflict(
        'این کار قبلاً توسط اپراتور دیگری برداشته شده است.',
        `Concurrent claim lost for WorkItem ${workItemId}`,
      );
    }

    const claimed = await this.store.findById(workItemId);
    if (!claimed || claimed.assignedToStaffId !== staffId) {
      /* Defensive: the store reported a win it did not perform. */
      throw DomainErrors.conflict(
        'این کار قبلاً توسط اپراتور دیگری برداشته شده است.',
        `Claim assertion failed for WorkItem ${workItemId}`,
      );
    }

    await this.audit.record({
      actor: staffId,
      actorType: 'STAFF',
      actorRole: staff.role,
      action: 'WORK_ITEM_CLAIMED',
      entity: 'WorkItem',
      entityId: workItemId,
      after: { status: claimed.status, assignedToStaffId: staffId },
    });

    return claimed;
  }

  /* --------------------------------------------------------- transitions */

  async start(workItemId: string, staffId: string): Promise<WorkItemSummary> {
    return this.transition(workItemId, staffId, ['ASSIGNED'], 'IN_PROGRESS', {
      releaseOrderLock: false,
    });
  }

  async waitForCustomer(workItemId: string, staffId: string): Promise<WorkItemSummary> {
    return this.transition(workItemId, staffId, ['ASSIGNED', 'IN_PROGRESS'], 'WAITING_CUSTOMER', {
      releaseOrderLock: false,
    });
  }

  async waitForSupplier(workItemId: string, staffId: string): Promise<WorkItemSummary> {
    return this.transition(workItemId, staffId, ['ASSIGNED', 'IN_PROGRESS'], 'WAITING_SUPPLIER', {
      releaseOrderLock: false,
    });
  }

  /**
   * Terminal transition. `activeOrderKey` is released here, which is what allows
   * a later re-fulfillment work item for the same order to exist at all.
   */
  async complete(
    workItemId: string,
    staffId: string,
    resolutionNote?: string,
  ): Promise<WorkItemSummary> {
    return this.transition(
      workItemId,
      staffId,
      ['ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SUPPLIER', 'NEED_REVIEW'],
      'COMPLETED',
      { releaseOrderLock: true, ...(resolutionNote === undefined ? {} : { resolutionNote }) },
    );
  }

  async fail(
    workItemId: string,
    staffId: string,
    resolutionNote: string,
  ): Promise<WorkItemSummary> {
    return this.transition(
      workItemId,
      staffId,
      ['ASSIGNED', 'IN_PROGRESS', 'WAITING_CUSTOMER', 'WAITING_SUPPLIER', 'NEED_REVIEW'],
      'FAILED',
      { releaseOrderLock: true, resolutionNote },
    );
  }

  /**
   * Closes a work item nobody has claimed, because automation finished the job.
   *
   * The transition is deliberately narrow: only `UNASSIGNED` qualifies, and the
   * update is a single conditional statement. The moment an operator claims the
   * item they own it, and a background purchase completing a second later must
   * not pull the task out from under them — it leaves the item alone, the
   * operator sees the delivered asset in their workspace, and closes it
   * themselves. This is also why the item is never *created* as COMPLETED: it
   * has to be visible and claimable while the supplier call is in flight.
   */
  async completeBySystem(input: {
    workItemId: string;
    actor: string;
    resolutionNote: string;
  }): Promise<WorkItemSummary | null> {
    const at = new Date();
    const changed = await this.store.completeUnassignedBySystem({
      workItemId: input.workItemId,
      at,
      resolutionNote: input.resolutionNote,
    });
    if (!changed) {
      return null;
    }

    await this.audit.record({
      actor: input.actor,
      actorType: 'SYSTEM',
      action: 'WORK_ITEM_COMPLETED',
      entity: 'WorkItem',
      entityId: input.workItemId,
      after: {
        status: 'COMPLETED',
        completedBy: input.actor,
        resolutionNote: input.resolutionNote,
        completedAt: at.toISOString(),
      },
    });

    return this.store.findById(input.workItemId);
  }

  /* ---------------------------------------------------------------- reads */

  async getById(workItemId: string): Promise<WorkItemSummary> {
    const item = await this.store.findById(workItemId);
    if (!item) {
      throw DomainErrors.notFound('WorkItem');
    }
    return item;
  }

  async findByOrderId(orderId: string): Promise<WorkItemSummary | null> {
    return this.store.findByOrderId(orderId);
  }

  async list(filter: {
    queueKey?: QueueKey;
    status?: WorkItemStatus;
    assignedToStaffId?: string;
    take?: number;
  } = {}): Promise<readonly WorkItemSummary[]> {
    return this.store.list({
      ...(filter.queueKey === undefined ? {} : { queueKey: filter.queueKey }),
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.assignedToStaffId === undefined
        ? {}
        : { assignedToStaffId: filter.assignedToStaffId }),
      take: Math.min(filter.take ?? 50, 200),
    });
  }

  /** How many of the operator's slots are currently occupied. */
  async activeCountFor(staffId: string): Promise<number> {
    return this.store.countActiveForStaff(staffId);
  }

  private async transition(
    workItemId: string,
    staffId: string,
    from: readonly WorkItemStatus[],
    to: WorkItemStatus,
    options: { releaseOrderLock: boolean; resolutionNote?: string },
  ): Promise<WorkItemSummary> {
    const changed = await this.store.transitionIfOwned({
      workItemId,
      staffId,
      from,
      to,
      at: new Date(),
      releaseOrderLock: options.releaseOrderLock,
      ...(options.resolutionNote === undefined ? {} : { resolutionNote: options.resolutionNote }),
    });

    if (!changed) {
      throw DomainErrors.conflict(
        'وضعیت این کار تغییر کرده است. صفحه را تازه کنید.',
        `Transition to ${to} rejected for WorkItem ${workItemId}`,
      );
    }

    await this.audit.record({
      actor: staffId,
      actorType: 'STAFF',
      action: `WORK_ITEM_${to}`,
      entity: 'WorkItem',
      entityId: workItemId,
      after: { status: to },
    });

    return this.getById(workItemId);
  }
}

export { ACTIVE_OPERATOR_STATUSES, MAX_CONCURRENT_WORK_ITEMS_PER_OPERATOR };
