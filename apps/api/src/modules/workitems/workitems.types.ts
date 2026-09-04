import type { QueueKey, WorkItemStatus, WorkItemType } from '@barat/contracts';

/* ============================================================================
 * Injection tokens
 *
 * `FULFILLMENT_TRIGGER` is the seam the payments workstream (B4) injects. It is
 * deliberately a narrow, one-method port: payment code must not be able to reach
 * into work-item internals, and this module must not have to know anything about
 * gateways.
 * ==========================================================================*/

export const FULFILLMENT_TRIGGER = Symbol.for('barat.fulfillment-trigger');
export const WORK_ITEM_STORE = Symbol.for('barat.work-item-store');
/** The port other modules use to raise an operator escalation. */
export const WORK_ITEM_ESCALATOR = Symbol.for('barat.work-item-escalator');

export interface FulfillmentTriggerInput {
  /** The order that has just reached `PAID`. */
  readonly orderId: string;
  readonly customerId?: string | null;
  /**
   * Omit it and the type is derived from the order's quote target — B4 knows a
   * payment settled, not whether the order is a gift card or a foreign payment.
   */
  readonly workItemType?: WorkItemType;
  readonly queueKey?: QueueKey;
  readonly title?: string;
  readonly description?: string;
  readonly priority?: number;
  readonly dueAt?: Date;
  /** Non-secret context for the operator workspace. Never a code, PIN or token. */
  readonly payload?: Record<string, unknown>;
}

/**
 * The port B4 calls once, after the payment transaction has COMMITTED.
 *
 * Implementations must be idempotent: five identical gateway callbacks for one
 * order produce exactly one work item.
 */
export interface FulfillmentTrigger {
  onOrderPaid(input: FulfillmentTriggerInput): Promise<WorkItemSummary>;
}

export interface EscalationInput {
  /** Deterministic, caller-derived. Replays must produce the same code. */
  readonly code: string;
  readonly orderId: string;
  readonly customerId?: string | null;
  readonly type: WorkItemType;
  readonly queueKey?: QueueKey;
  readonly title?: string;
  readonly description?: string | null;
  readonly priority?: number;
  /** Non-secret diagnostic context. Never a code, PIN or provider payload. */
  readonly payload?: Record<string, unknown> | null;
  readonly actor?: string;
}

/**
 * Raise a secondary work item for an order that already has one.
 *
 * Implementations must be idempotent on `code`, and must not take the order's
 * active-work-item lock.
 */
export interface WorkItemEscalator {
  openEscalation(input: EscalationInput): Promise<WorkItemSummary>;
}

/* ============================================================================
 * Policy
 * ==========================================================================*/

/** Statuses in which a work item still occupies one of an operator's slots. */
export const ACTIVE_OPERATOR_STATUSES: readonly WorkItemStatus[] = [
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'WAITING_SUPPLIER',
  'NEED_REVIEW',
];

export const WORK_ITEM_TERMINAL_STATUSES: readonly WorkItemStatus[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];

/** Server-side cap. The operator UI may show fewer, never more. */
export const MAX_CONCURRENT_WORK_ITEMS_PER_OPERATOR = 3;

/** Roles that may hold a work item. Enforced on the server, never by hiding UI. */
export const CLAIMING_ROLES = ['ADMIN', 'OPS_MANAGER', 'OPERATOR'] as const;

export const DEFAULT_QUEUE_BY_WORK_ITEM_TYPE: Readonly<Record<WorkItemType, QueueKey>> = {
  MANUAL_GIFT_CARD_FULFILLMENT: 'GIFT_CARD_MANUAL',
  INTERNATIONAL_PAYMENT: 'SAAS_PAYMENT',
  CUSTOMER_INFORMATION: 'CUSTOMER_INFO_REQUIRED',
  SUPPLIER_FOLLOWUP: 'SUPPLIER_ISSUE',
  UNKNOWN_OUTCOME: 'UNKNOWN_OUTCOME',
  REFUND_REVIEW: 'REFUND_REVIEW',
  SUPPORT_REQUEST: 'CUSTOMER_INFO_REQUIRED',
};

export const DEFAULT_TITLE_BY_WORK_ITEM_TYPE: Readonly<Record<WorkItemType, string>> = {
  MANUAL_GIFT_CARD_FULFILLMENT: 'تحویل دستی گیفت‌کارت',
  INTERNATIONAL_PAYMENT: 'پرداخت بین‌المللی',
  CUSTOMER_INFORMATION: 'نیاز به اطلاعات مشتری',
  SUPPLIER_FOLLOWUP: 'پیگیری تأمین‌کننده',
  UNKNOWN_OUTCOME: 'نتیجهٔ نامشخص تأمین‌کننده',
  REFUND_REVIEW: 'بررسی بازگشت وجه',
  SUPPORT_REQUEST: 'درخواست پشتیبانی',
};

/* ============================================================================
 * Read models
 * ==========================================================================*/

/**
 * The only shape a work item leaves this module in.
 *
 * There is no `payload` passthrough on purpose: a raw JSON blob is exactly where
 * a gift-card code would eventually get smuggled into a list endpoint.
 */
export interface WorkItemSummary {
  readonly id: string;
  readonly code: string;
  readonly orderId: string | null;
  readonly customerId: string | null;
  readonly queueKey: QueueKey;
  readonly type: WorkItemType;
  readonly status: WorkItemStatus;
  readonly priority: number;
  readonly assignedToStaffId: string | null;
  /** Safe display identity for operational reports; never an email or credential. */
  readonly assignedToStaffName?: string | null;
  readonly assignedAt: Date | null;
  readonly startedAt: Date | null;
  readonly completedAt: Date | null;
  readonly dueAt: Date | null;
  readonly slaBreachedAt?: Date | null;
  readonly title: string;
  readonly description: string | null;
  readonly createdAt: Date;
}

/* ============================================================================
 * Persistence port
 * ==========================================================================*/

export interface CreateWorkItemRecord {
  readonly code: string;
  readonly orderId: string;
  readonly customerId: string | null;
  readonly queueKey: QueueKey;
  readonly type: WorkItemType;
  readonly priority: number;
  readonly title: string;
  readonly description: string | null;
  readonly dueAt: Date | null;
  readonly payload: Record<string, unknown> | null;
  /**
   * Whether this item takes the order's single "active work item" lock.
   *
   * The fulfillment item for a paid order does. An escalation raised alongside it
   * (an UNKNOWN supplier outcome, a customer-information request) must not, or the
   * unique `activeOrderKey` would reject it and the escalation would be lost.
   */
  readonly holdsOrderLock: boolean;
}

export interface ClaimingStaff {
  readonly id: string;
  readonly role: string;
  readonly isActive: boolean;
}

/**
 * Everything the service needs from the database, expressed as intentions rather
 * than queries.
 *
 * `claimIfUnassigned` is the critical one: an implementation MUST perform a
 * single atomic conditional update and return whether it changed exactly one
 * row. The service asserts on that boolean; it never re-reads and re-decides.
 */
/**
 * What a paid order is for, read from the immutable quote it was placed from.
 *
 * A quote carries exactly one of `skuId` / `serviceId`, so the two cases are
 * total: a SKU is a gift card we hand over, a service is a payment we make
 * abroad on the customer's behalf.
 */
export type OrderQuoteTarget = 'SKU' | 'SERVICE';

export interface WorkItemStore {
  findByOrderId(orderId: string): Promise<WorkItemSummary | null>;
  /** `null` when the order (or its quote) cannot be resolved. */
  findOrderQuoteTarget(orderId: string): Promise<OrderQuoteTarget | null>;
  findById(workItemId: string): Promise<WorkItemSummary | null>;
  /** Used to make escalation creation idempotent on a deterministic code. */
  findByCode(code: string): Promise<WorkItemSummary | null>;
  list(filter: {
    queueKey?: QueueKey;
    status?: WorkItemStatus;
    assignedToStaffId?: string;
    take: number;
  }): Promise<readonly WorkItemSummary[]>;
  create(record: CreateWorkItemRecord): Promise<WorkItemSummary>;
  findStaff(staffId: string): Promise<ClaimingStaff | null>;
  isQueueMember(queueKey: QueueKey, staffId: string): Promise<boolean>;
  countActiveForStaff(staffId: string): Promise<number>;
  /** Atomic compare-and-set. `true` only when this caller changed the row. */
  claimIfUnassigned(workItemId: string, staffId: string, at: Date): Promise<boolean>;
  /**
   * Atomic compare-and-set from `UNASSIGNED` to `COMPLETED`, with no claimant.
   *
   * Separate from `transitionIfOwned` on purpose: that method's `WHERE` clause
   * pins `assignedToStaffId`, which is exactly the guarantee the system actor
   * must not be able to weaken. `true` only when this caller changed the row.
   */
  completeUnassignedBySystem(input: {
    workItemId: string;
    at: Date;
    resolutionNote: string;
  }): Promise<boolean>;
  /** Atomic compare-and-set across a set of allowed source statuses. */
  transitionIfOwned(input: {
    workItemId: string;
    staffId: string;
    from: readonly WorkItemStatus[];
    to: WorkItemStatus;
    at: Date;
    resolutionNote?: string;
    /** Terminal transitions release `activeOrderKey`. */
    releaseOrderLock: boolean;
  }): Promise<boolean>;
}
