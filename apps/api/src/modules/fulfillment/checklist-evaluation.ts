import type { ChecklistItemStatus, ChecklistStatus, OrderStatus } from '@barat/contracts';

import { REQUIRED_FIELD_CONTEXT_SOURCES } from './checklist-templates';
import { assessCostVariance, type CostVarianceAssessment } from './cost-variance';
import {
  SYSTEM_VERIFIED_KEYS,
  type ChecklistItemRecord,
  type ChecklistRecord,
  type FulfillmentContext,
} from './fulfillment.types';

/**
 * Pure checklist evaluation.
 *
 * Everything the send gate decides is computed here, from a database snapshot and
 * nothing else — no request body, no frontend-supplied flags. `FulfillmentService`
 * only persists the result. Keeping it pure is what makes "send is blocked while
 * the checklist is incomplete" testable without a database or an HTTP layer.
 */

/** Order statuses in which a fulfillment may still be delivered. */
export const DELIVERABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  'PAID',
  'FULFILLMENT_PENDING',
  'FULFILLING',
];

export const SEND_BLOCKERS = {
  CHECKLIST_LOCKED: 'CHECKLIST_LOCKED',
  PAYMENT_NOT_VERIFIED: 'PAYMENT_NOT_VERIFIED',
  ORDER_NOT_DELIVERABLE: 'ORDER_NOT_DELIVERABLE',
  ASSET_MISSING: 'ASSET_MISSING',
  ACTUAL_COST_MISSING: 'ACTUAL_COST_MISSING',
  COST_VARIANCE_UNAPPROVED: 'COST_VARIANCE_UNAPPROVED',
  CHECKLIST_INCOMPLETE: 'CHECKLIST_INCOMPLETE',
  DELIVERY_EMAIL_MISSING: 'DELIVERY_EMAIL_MISSING',
} as const;

export type SendBlocker = (typeof SEND_BLOCKERS)[keyof typeof SEND_BLOCKERS];

export interface EvaluatedChecklistItem {
  readonly record: ChecklistItemRecord;
  readonly status: ChecklistItemStatus;
  /** True when `status` differs from what is currently persisted. */
  readonly changed: boolean;
}

export interface ChecklistEvaluation {
  readonly items: readonly EvaluatedChecklistItem[];
  readonly checklistStatus: ChecklistStatus;
  readonly blockedReason: string | null;
  /** Keys of blocking items that are not yet satisfied. */
  readonly unsatisfiedKeys: readonly string[];
}

const SATISFIED: readonly ChecklistItemStatus[] = ['PASSED', 'NOT_APPLICABLE'];

/**
 * Assess the recorded spend against the quoted one for this order.
 *
 * Returns `null` while no actual cost has been recorded — there is nothing to
 * judge yet, and the blocking `ACTUAL_COST_PRESENT` item is what holds the send.
 */
export function assessContextCostVariance(context: FulfillmentContext): CostVarianceAssessment | null {
  const fulfillment = context.fulfillment;
  if (fulfillment === null || fulfillment.actualSupplierCost === null) {
    return null;
  }

  return assessCostVariance({
    quotedCost: context.quotedSupplierCost,
    quotedCurrency: context.quotedSupplierCurrency,
    actualCost: fulfillment.actualSupplierCost,
    actualCurrency: fulfillment.actualSupplierCurrency ?? context.quotedSupplierCurrency,
    toleranceBps: context.maxSupplierCostToleranceBps,
  });
}

export function isSatisfied(status: ChecklistItemStatus): boolean {
  return SATISFIED.includes(status);
}

function isNonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * SYSTEM_VERIFIED derivation.
 *
 * `GIFT_CARD_ASSET_PRESENT` is answered by `assetCount`, i.e. by the existence of
 * a row — the checklist never decrypts, never sees and never needs the plaintext
 * code. That is deliberate: it keeps the most sensitive value in the system out
 * of the code path that runs on every checklist read.
 */
export function deriveSystemVerifiedStatus(key: string, context: FulfillmentContext): ChecklistItemStatus {
  switch (key) {
    case SYSTEM_VERIFIED_KEYS.PAYMENT_VERIFIED:
      return context.hasVerifiedPayment ? 'PASSED' : 'PENDING';
    case SYSTEM_VERIFIED_KEYS.ACTUAL_COST_PRESENT:
      return isNonEmpty(context.fulfillment?.actualSupplierCost) ? 'PASSED' : 'PENDING';
    case SYSTEM_VERIFIED_KEYS.PROVIDER_REFERENCE_PRESENT:
      return isNonEmpty(context.fulfillment?.supplierReference) ||
        isNonEmpty(context.fulfillment?.supplierOrderId)
        ? 'PASSED'
        : 'PENDING';
    case SYSTEM_VERIFIED_KEYS.GIFT_CARD_ASSET_PRESENT:
      return context.assetCount > 0 ? 'PASSED' : 'PENDING';
    default:
      // An unknown SYSTEM_VERIFIED key can never be satisfied by a human, so it
      // stays PENDING rather than silently passing.
      return 'PENDING';
  }
}

function deriveRequiredFieldStatus(item: ChecklistItemRecord, context: FulfillmentContext): ChecklistItemStatus {
  if (item.key in REQUIRED_FIELD_CONTEXT_SOURCES) {
    const source = REQUIRED_FIELD_CONTEXT_SOURCES[item.key as keyof typeof REQUIRED_FIELD_CONTEXT_SOURCES];
    return isNonEmpty(context[source]) ? 'PASSED' : 'PENDING';
  }
  // Operator-supplied field: it auto-passes the moment a value exists.
  return item.hasValue ? 'PASSED' : 'PENDING';
}

export function deriveItemStatus(
  item: ChecklistItemRecord,
  context: FulfillmentContext,
): ChecklistItemStatus {
  // A named operator confirmation is an explicit checklist decision. It may
  // satisfy an item before the system can derive it, without changing any of
  // the independent payment, order, asset, cost or delivery send gates. Once
  // confirmed, ChecklistService persists the item as BOOLEAN, so it stays
  // reversible instead of being re-derived immediately after an untick.
  if (item.verifiedByStaffId !== null && item.verifiedAt !== null) {
    return item.status;
  }

  switch (item.type) {
    case 'SYSTEM_VERIFIED':
      return deriveSystemVerifiedStatus(item.key, context);
    case 'REQUIRED_FIELD':
      return deriveRequiredFieldStatus(item, context);
    case 'BOOLEAN':
      return item.status;
    case 'MANAGER_APPROVAL':
      // Legacy manager-only rows are omitted from active checklists below.
      return item.status;
    default:
      return item.status;
  }
}

export function evaluateChecklist(input: {
  checklist: ChecklistRecord;
  context: FulfillmentContext;
  isLocked: boolean;
}): ChecklistEvaluation {
  const { checklist, context, isLocked } = input;

  // Manager-only rows from an older template are no longer part of any active
  // checklist. The financial cost-variance gate remains enforced independently
  // in `computeSendBlockers`; hiding a legacy row cannot release that gate.
  const activeRecords = checklist.items.filter((record) => record.type !== 'MANAGER_APPROVAL');

  // A locked checklist is frozen: it is the record of what was true at the moment
  // the asset went out. Re-deriving it later would rewrite history.
  if (isLocked) {
    return {
      items: activeRecords.map((record) => ({ record, status: record.status, changed: false })),
      checklistStatus: checklist.status,
      blockedReason: checklist.blockedReason,
      unsatisfiedKeys: [],
    };
  }

  const items = activeRecords.map((record) => {
    const status = deriveItemStatus(record, context);
    return { record, status, changed: status !== record.status };
  });

  const blocking = items.filter((item) => item.record.isBlocking);
  const unsatisfiedKeys = blocking.filter((item) => !isSatisfied(item.status)).map((item) => item.record.key);
  const waitingApproval = blocking.some((item) => item.status === 'WAITING_APPROVAL');
  const failed = blocking.some((item) => item.status === 'FAILED');

  let checklistStatus: ChecklistStatus;
  let blockedReason: string | null = null;

  if (failed) {
    checklistStatus = 'BLOCKED';
    blockedReason = 'CHECKLIST_ITEM_FAILED';
  } else if (waitingApproval) {
    checklistStatus = 'BLOCKED';
    blockedReason = SEND_BLOCKERS.COST_VARIANCE_UNAPPROVED;
  } else if (unsatisfiedKeys.length === 0) {
    checklistStatus = 'READY_FOR_REVIEW';
  } else {
    checklistStatus = 'INCOMPLETE';
  }

  return { items, checklistStatus, blockedReason, unsatisfiedKeys };
}

/**
 * The authoritative send gate.
 *
 * Every condition is re-derived from the database snapshot. The frontend may have
 * shown a green checklist; that carries no weight here. An empty result means the
 * send may proceed.
 */
export function computeSendBlockers(input: {
  context: FulfillmentContext;
  evaluation: ChecklistEvaluation;
  variance: CostVarianceAssessment | null;
  isLocked: boolean;
}): readonly SendBlocker[] {
  const { context, evaluation, variance, isLocked } = input;
  const blockers: SendBlocker[] = [];

  if (isLocked) {
    blockers.push(SEND_BLOCKERS.CHECKLIST_LOCKED);
  }

  if (!context.hasVerifiedPayment) {
    blockers.push(SEND_BLOCKERS.PAYMENT_NOT_VERIFIED);
  }

  if (!DELIVERABLE_ORDER_STATUSES.includes(context.orderStatus)) {
    blockers.push(SEND_BLOCKERS.ORDER_NOT_DELIVERABLE);
  }

  if (context.assetCount < 1) {
    blockers.push(SEND_BLOCKERS.ASSET_MISSING);
  }

  if (!isNonEmpty(context.fulfillment?.actualSupplierCost)) {
    blockers.push(SEND_BLOCKERS.ACTUAL_COST_MISSING);
  }

  if (variance !== null && variance.requiresApproval) {
    const approved =
      context.fulfillment?.approvedByStaffId != null && context.fulfillment?.approvedAt != null;
    if (!approved) {
      blockers.push(SEND_BLOCKERS.COST_VARIANCE_UNAPPROVED);
    }
  }

  if (evaluation.unsatisfiedKeys.length > 0) {
    blockers.push(SEND_BLOCKERS.CHECKLIST_INCOMPLETE);
  }

  return blockers;
}
