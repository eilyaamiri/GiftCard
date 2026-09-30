import { z } from 'zod';

import { enumFrom } from '../internal/enum-utils';

/* ============================================================================
 * Work items
 * ==========================================================================*/

export const WORK_ITEM_STATUS_VALUES = [
  'UNASSIGNED',
  'ASSIGNED',
  'IN_PROGRESS',
  'WAITING_CUSTOMER',
  'WAITING_SUPPLIER',
  'NEED_REVIEW',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export const WorkItemStatus = enumFrom(WORK_ITEM_STATUS_VALUES);
export type WorkItemStatus = (typeof WORK_ITEM_STATUS_VALUES)[number];
export const workItemStatusSchema = z.enum(WORK_ITEM_STATUS_VALUES);

/** A work item in one of these statuses is finished and releases the order lock. */
export const WORK_ITEM_TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const;
export type WorkItemTerminalStatus = (typeof WORK_ITEM_TERMINAL_STATUSES)[number];

/** The seven operator task types; each one has a dedicated task workspace. */
export const WORK_ITEM_TYPE_VALUES = [
  'MANUAL_GIFT_CARD_FULFILLMENT',
  'INTERNATIONAL_PAYMENT',
  'CUSTOMER_INFORMATION',
  'SUPPLIER_FOLLOWUP',
  'UNKNOWN_OUTCOME',
  'REFUND_REVIEW',
  'SUPPORT_REQUEST',
] as const;

export const WorkItemType = enumFrom(WORK_ITEM_TYPE_VALUES);
export type WorkItemType = (typeof WORK_ITEM_TYPE_VALUES)[number];
export const workItemTypeSchema = z.enum(WORK_ITEM_TYPE_VALUES);

export const QUEUE_KEY_VALUES = [
  'GIFT_CARD_MANUAL',
  'SAAS_PAYMENT',
  'AI_TOOLS',
  'DOMAIN_HOSTING',
  'EXAM_PAYMENT',
  'SUPPLIER_ISSUE',
  'CUSTOMER_INFO_REQUIRED',
  'UNKNOWN_OUTCOME',
  'REFUND_REVIEW',
] as const;

export const QueueKey = enumFrom(QUEUE_KEY_VALUES);
export type QueueKey = (typeof QUEUE_KEY_VALUES)[number];
export const queueKeySchema = z.enum(QUEUE_KEY_VALUES);

/* ============================================================================
 * Fulfillment checklist
 * ==========================================================================*/

/**
 * `SYSTEM_VERIFIED` items cannot be ticked by an operator — the backend sets
 * them. `MANAGER_APPROVAL` items require a second person with a manager role.
 */
export const CHECKLIST_ITEM_TYPE_VALUES = [
  'BOOLEAN',
  'SYSTEM_VERIFIED',
  'REQUIRED_FIELD',
  'MANAGER_APPROVAL',
] as const;

export const ChecklistItemType = enumFrom(CHECKLIST_ITEM_TYPE_VALUES);
export type ChecklistItemType = (typeof CHECKLIST_ITEM_TYPE_VALUES)[number];
export const checklistItemTypeSchema = z.enum(CHECKLIST_ITEM_TYPE_VALUES);

export const CHECKLIST_ITEM_STATUS_VALUES = [
  'PENDING',
  'PASSED',
  'FAILED',
  'NOT_APPLICABLE',
  'WAITING_APPROVAL',
] as const;

export const ChecklistItemStatus = enumFrom(CHECKLIST_ITEM_STATUS_VALUES);
export type ChecklistItemStatus = (typeof CHECKLIST_ITEM_STATUS_VALUES)[number];
export const checklistItemStatusSchema = z.enum(CHECKLIST_ITEM_STATUS_VALUES);

export const CHECKLIST_STATUS_VALUES = [
  'INCOMPLETE',
  'READY_FOR_REVIEW',
  'COMPLETED',
  'BLOCKED',
] as const;

export const ChecklistStatus = enumFrom(CHECKLIST_STATUS_VALUES);
export type ChecklistStatus = (typeof CHECKLIST_STATUS_VALUES)[number];
export const checklistStatusSchema = z.enum(CHECKLIST_STATUS_VALUES);

/* ============================================================================
 * Delivery
 * ==========================================================================*/

/**
 * IMPORTANT — a finding from the provider documentation that invalidates the
 * naive "the operator always types a code" model:
 *
 *   CODE                  : raw code only            (Tillo)
 *   CODE_PIN              : code + PIN               (Tillo, some regions)
 *   URL                   : redemption link only     (Runa, Giftbit)
 *   PROVIDER_DIRECT_EMAIL : the provider e-mails the customer directly and the
 *                           operator never sees a code at all (Reloadly, Runa,
 *                           Giftbit). There is nothing to store or to send.
 *   DIRECT_TOPUP          : the supplier credits the customer's own game account
 *                           directly. There is no code, no link and no e-mail;
 *                           the only artefact is a confirmation reference. A
 *                           top-up order creates no WorkItem on the happy path.
 */
export const DELIVERY_ASSET_TYPE_VALUES = [
  'CODE',
  'CODE_PIN',
  'URL',
  'PROVIDER_DIRECT_EMAIL',
  'DIRECT_TOPUP',
] as const;

export const DeliveryAssetType = enumFrom(DELIVERY_ASSET_TYPE_VALUES);
export type DeliveryAssetType = (typeof DELIVERY_ASSET_TYPE_VALUES)[number];
export const deliveryAssetTypeSchema = z.enum(DELIVERY_ASSET_TYPE_VALUES);

/** Asset types for which an encrypted secret must exist before sending. */
export const DELIVERY_ASSET_TYPES_WITH_SECRET = ['CODE', 'CODE_PIN'] as const;

export const DELIVERY_STATUS_VALUES = [
  'NOT_READY',
  'READY',
  'SENDING',
  'SENT',
  'DELIVERY_FAILED',
] as const;

export const DeliveryStatus = enumFrom(DELIVERY_STATUS_VALUES);
export type DeliveryStatus = (typeof DELIVERY_STATUS_VALUES)[number];
export const deliveryStatusSchema = z.enum(DELIVERY_STATUS_VALUES);

/* ============================================================================
 * Direct top-up
 *
 * A top-up is delivered by the supplier crediting the customer's game account.
 * It produces no code, no PIN and no link — only a confirmation reference and
 * an append-only history. It is therefore tracked by `TopUpFulfillment` /
 * `TopUpEvent` and NOT by a `WorkItem`: per the product owner's rule, a direct
 * top-up is fully automated and never lands in an operator's queue of its own
 * accord. A WorkItem is raised only when the purchase genuinely failed or its
 * outcome is ambiguous, so that a person can investigate and answer the
 * customer through that one path.
 * ==========================================================================*/

/**
 * Where one top-up is in the automated flow.
 *
 * `UNKNOWN` is deliberately distinct from `FAILED`: it means the supplier may
 * have charged us, so a refund or a retry would be a real loss. Only a person
 * resolves an `UNKNOWN`.
 */
export const TOP_UP_STATUS_VALUES = [
  /** Paid, waiting for the worker. */
  'QUEUED',
  /** Supplier balance too low; retried automatically. */
  'WAITING_FUNDS',
  /** The purchase call is in flight. */
  'PURCHASING',
  /** Supplier accepted and is still processing; polled automatically. */
  'AWAITING_PROVIDER',
  'SUCCEEDED',
  /** The supplier stated nothing was charged. Safe to refund. */
  'FAILED',
  /** The supplier may have charged; never re-bought automatically. */
  'UNKNOWN',
] as const;

export const TopUpStatus = enumFrom(TOP_UP_STATUS_VALUES);
export type TopUpStatus = (typeof TOP_UP_STATUS_VALUES)[number];
export const topUpStatusSchema = z.enum(TOP_UP_STATUS_VALUES);

/** Statuses that mean the top-up will never change again on its own. */
export const TOP_UP_TERMINAL_STATUSES = ['SUCCEEDED', 'FAILED', 'UNKNOWN'] as const;

/** One step recorded in a top-up's append-only trace. */
export const TOP_UP_EVENT_TYPE_VALUES = [
  'QUEUED',
  'ELIGIBILITY_CHECKED',
  'BALANCE_CHECKED',
  'PURCHASE_REQUESTED',
  'PURCHASE_RESPONDED',
  'STATUS_POLLED',
  'SUCCEEDED',
  'FAILED',
  'MARKED_UNKNOWN',
  'REFUND_OPENED',
  'CUSTOMER_NOTIFIED',
  'OPERATOR_NOTE',
  'OPERATOR_ACTION',
] as const;

export const TopUpEventType = enumFrom(TOP_UP_EVENT_TYPE_VALUES);
export type TopUpEventType = (typeof TOP_UP_EVENT_TYPE_VALUES)[number];
export const topUpEventTypeSchema = z.enum(TOP_UP_EVENT_TYPE_VALUES);

/** Event types an operator may write; both require a note. */
export const TOP_UP_OPERATOR_EVENT_TYPES = ['OPERATOR_NOTE', 'OPERATOR_ACTION'] as const;

/* ============================================================================
 * Pricing rule scope
 * ==========================================================================*/

/**
 * How specific a `PricingRule` is. A quote walks from the most specific scope
 * that names it down to `GLOBAL`, and the first match wins.
 *
 * `TOP_UP_GAME` exists so a direct top-up carries its own margin — the product
 * owner set it at 5% — independently of gift cards. `targetId` is a `TopUpGame`
 * id to price one game differently, or null to cover every top-up. If no
 * `TOP_UP_GAME` rule exists, the `GLOBAL` rule applies as before; the 5% is a
 * seeded data value, never a constant in the pricing formula, so an
 * administrator can change it without a deployment.
 */
export const PRICING_RULE_SCOPE_VALUES = [
  'GLOBAL',
  'PRODUCT',
  'SKU',
  'SERVICE',
  'TOP_UP_GAME',
] as const;

export const PricingRuleScope = enumFrom(PRICING_RULE_SCOPE_VALUES);
export type PricingRuleScope = (typeof PRICING_RULE_SCOPE_VALUES)[number];
export const pricingRuleScopeSchema = z.enum(PRICING_RULE_SCOPE_VALUES);
