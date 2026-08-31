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
 */
export const DELIVERY_ASSET_TYPE_VALUES = [
  'CODE',
  'CODE_PIN',
  'URL',
  'PROVIDER_DIRECT_EMAIL',
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
