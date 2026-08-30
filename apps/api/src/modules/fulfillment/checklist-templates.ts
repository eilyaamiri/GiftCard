import type { QueueKey, WorkItemType } from '@barat/contracts';

import { COST_VARIANCE_APPROVAL_KEY, SYSTEM_VERIFIED_KEYS, type ChecklistItemDefinition } from './fulfillment.types';

/**
 * Shipped checklist templates.
 *
 * A template is data, not code: it is persisted as `TaskChecklistTemplate.definition`
 * and a checklist instance is materialised from the persisted row. These constants
 * are the seed for version 1 — later versions are edited in the admin panel and
 * live only in the database, so changing a constant here never rewrites history
 * for checklists that were already created.
 *
 * Item type semantics (enforced in `ChecklistService`):
 *   SYSTEM_VERIFIED  – derived from real state on every read. Not clickable.
 *   REQUIRED_FIELD   – passes as soon as the field it points at has a value.
 *   BOOLEAN          – a human confirmation; records verifiedBy / verifiedAt.
 *   MANAGER_APPROVAL – needs a second person holding a manager role.
 */

/** REQUIRED_FIELD keys that read from order state instead of operator input. */
export const REQUIRED_FIELD_CONTEXT_SOURCES = {
  DELIVERY_EMAIL_PRESENT: 'deliveryEmail',
} as const satisfies Record<string, 'deliveryEmail'>;

export type ContextSourcedFieldKey = keyof typeof REQUIRED_FIELD_CONTEXT_SOURCES;

export const DEFAULT_GIFT_CARD_MANUAL_CHECKLIST: readonly ChecklistItemDefinition[] = [
  {
    key: SYSTEM_VERIFIED_KEYS.PAYMENT_VERIFIED,
    label: 'Customer payment verified',
    labelFa: 'پرداخت مشتری تأیید شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 10,
  },
  {
    key: 'DELIVERY_EMAIL_PRESENT',
    label: 'Delivery e-mail recorded',
    labelFa: 'ایمیل تحویل ثبت شده است',
    type: 'REQUIRED_FIELD',
    isBlocking: true,
    sortOrder: 20,
  },
  {
    key: 'SUPPLIER_ORDER_PLACED',
    label: 'Order placed with the supplier',
    labelFa: 'سفارش نزد تأمین‌کننده ثبت شد',
    type: 'BOOLEAN',
    isBlocking: true,
    sortOrder: 30,
  },
  {
    key: SYSTEM_VERIFIED_KEYS.PROVIDER_REFERENCE_PRESENT,
    label: 'Supplier reference recorded',
    labelFa: 'کد پیگیری تأمین‌کننده ثبت شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 40,
  },
  {
    key: SYSTEM_VERIFIED_KEYS.ACTUAL_COST_PRESENT,
    label: 'Actual supplier cost recorded',
    labelFa: 'هزینهٔ واقعی تأمین‌کننده ثبت شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 50,
  },
  {
    key: SYSTEM_VERIFIED_KEYS.GIFT_CARD_ASSET_PRESENT,
    label: 'Delivery asset stored',
    labelFa: 'دارایی تحویل ذخیره شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 60,
  },
  {
    key: 'ASSET_MATCHES_ORDER',
    label: 'Asset value and region match the order',
    labelFa: 'مبلغ و منطقهٔ کارت با سفارش مطابقت دارد',
    type: 'BOOLEAN',
    isBlocking: true,
    sortOrder: 70,
  },
  {
    key: COST_VARIANCE_APPROVAL_KEY,
    label: 'Supplier cost variance approved by a manager',
    labelFa: 'اختلاف هزینهٔ تأمین‌کننده توسط مدیر تأیید شده است',
    type: 'MANAGER_APPROVAL',
    isBlocking: true,
    sortOrder: 80,
  },
];

export const DEFAULT_INTERNATIONAL_PAYMENT_CHECKLIST: readonly ChecklistItemDefinition[] = [
  {
    key: SYSTEM_VERIFIED_KEYS.PAYMENT_VERIFIED,
    label: 'Customer payment verified',
    labelFa: 'پرداخت مشتری تأیید شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 10,
  },
  {
    key: 'DELIVERY_EMAIL_PRESENT',
    label: 'Delivery e-mail recorded',
    labelFa: 'ایمیل تحویل ثبت شده است',
    type: 'REQUIRED_FIELD',
    isBlocking: true,
    sortOrder: 20,
  },
  {
    key: 'SERVICE_ACCOUNT_REFERENCE',
    label: 'Customer service account / invoice reference recorded',
    labelFa: 'شناسهٔ حساب یا شمارهٔ صورتحساب مشتری ثبت شده است',
    type: 'REQUIRED_FIELD',
    isBlocking: true,
    sortOrder: 30,
  },
  {
    key: 'PAYMENT_EXECUTED_ABROAD',
    label: 'Payment executed on the foreign provider',
    labelFa: 'پرداخت روی سرویس خارجی انجام شد',
    type: 'BOOLEAN',
    isBlocking: true,
    sortOrder: 40,
  },
  {
    key: SYSTEM_VERIFIED_KEYS.PROVIDER_REFERENCE_PRESENT,
    label: 'Provider reference recorded',
    labelFa: 'کد پیگیری سرویس‌دهنده ثبت شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 50,
  },
  {
    key: SYSTEM_VERIFIED_KEYS.ACTUAL_COST_PRESENT,
    label: 'Actual cost recorded',
    labelFa: 'هزینهٔ واقعی ثبت شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 60,
  },
  {
    key: SYSTEM_VERIFIED_KEYS.GIFT_CARD_ASSET_PRESENT,
    label: 'Receipt / confirmation asset stored',
    labelFa: 'رسید یا تأییدیهٔ تحویل ذخیره شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 70,
  },
  {
    key: 'SUBSCRIPTION_ACTIVE_CONFIRMED',
    label: 'Subscription / service confirmed active',
    labelFa: 'فعال بودن سرویس بررسی و تأیید شد',
    type: 'BOOLEAN',
    isBlocking: true,
    sortOrder: 80,
  },
  {
    key: COST_VARIANCE_APPROVAL_KEY,
    label: 'Cost variance approved by a manager',
    labelFa: 'اختلاف هزینه توسط مدیر تأیید شده است',
    type: 'MANAGER_APPROVAL',
    isBlocking: true,
    sortOrder: 90,
  },
];

interface ShippedTemplate {
  readonly workItemType: WorkItemType;
  readonly queueKey: QueueKey;
  readonly definition: readonly ChecklistItemDefinition[];
}

/**
 * The default template for every work item type. Types with no bespoke checklist
 * fall back to the generic payment-verification skeleton so a checklist always
 * exists and the send gate always has something to evaluate.
 */
const GENERIC_CHECKLIST: readonly ChecklistItemDefinition[] = [
  {
    key: SYSTEM_VERIFIED_KEYS.PAYMENT_VERIFIED,
    label: 'Customer payment verified',
    labelFa: 'پرداخت مشتری تأیید شده است',
    type: 'SYSTEM_VERIFIED',
    isBlocking: true,
    sortOrder: 10,
  },
  {
    key: 'ISSUE_RESOLVED',
    label: 'Issue resolved and documented',
    labelFa: 'موضوع بررسی و مستند شد',
    type: 'BOOLEAN',
    isBlocking: true,
    sortOrder: 20,
  },
  {
    key: COST_VARIANCE_APPROVAL_KEY,
    label: 'Cost variance approved by a manager',
    labelFa: 'اختلاف هزینه توسط مدیر تأیید شده است',
    type: 'MANAGER_APPROVAL',
    isBlocking: true,
    sortOrder: 30,
  },
];

export const SHIPPED_CHECKLIST_TEMPLATES: Readonly<Record<WorkItemType, ShippedTemplate>> = {
  MANUAL_GIFT_CARD_FULFILLMENT: {
    workItemType: 'MANUAL_GIFT_CARD_FULFILLMENT',
    queueKey: 'GIFT_CARD_MANUAL',
    definition: DEFAULT_GIFT_CARD_MANUAL_CHECKLIST,
  },
  INTERNATIONAL_PAYMENT: {
    workItemType: 'INTERNATIONAL_PAYMENT',
    queueKey: 'SAAS_PAYMENT',
    definition: DEFAULT_INTERNATIONAL_PAYMENT_CHECKLIST,
  },
  CUSTOMER_INFORMATION: {
    workItemType: 'CUSTOMER_INFORMATION',
    queueKey: 'CUSTOMER_INFO_REQUIRED',
    definition: GENERIC_CHECKLIST,
  },
  SUPPLIER_FOLLOWUP: {
    workItemType: 'SUPPLIER_FOLLOWUP',
    queueKey: 'SUPPLIER_ISSUE',
    definition: GENERIC_CHECKLIST,
  },
  UNKNOWN_OUTCOME: {
    workItemType: 'UNKNOWN_OUTCOME',
    queueKey: 'UNKNOWN_OUTCOME',
    definition: GENERIC_CHECKLIST,
  },
  REFUND_REVIEW: {
    workItemType: 'REFUND_REVIEW',
    queueKey: 'REFUND_REVIEW',
    definition: GENERIC_CHECKLIST,
  },
  SUPPORT_REQUEST: {
    workItemType: 'SUPPORT_REQUEST',
    queueKey: 'CUSTOMER_INFO_REQUIRED',
    definition: GENERIC_CHECKLIST,
  },
};

export function templateFor(workItemType: WorkItemType): ShippedTemplate {
  return SHIPPED_CHECKLIST_TEMPLATES[workItemType];
}
