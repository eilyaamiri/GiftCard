import { z } from "zod";
import {
  checklistItemStatusSchema,
  checklistItemTypeSchema,
  checklistStatusSchema,
  deliveryAssetTypeSchema,
  deliveryStatusSchema,
  isoDateTimeSchema,
  type ChecklistItemStatus,
  type ChecklistItemType,
  type ChecklistStatus,
  type DeliveryAssetType,
  type DeliveryStatus,
  type StaffRole,
} from "@barat/contracts";
import { api, hasRole } from "@/lib/api";

/**
 * Client for `/api/operator/fulfillment/:workItemId`.
 *
 * Pinned to `FulfillmentWorkspace` in
 * `apps/api/src/modules/fulfillment/fulfillment.service.ts`. The asset view has
 * no `code`/`pin` field by construction — the plaintext exists only in the
 * response of the reveal endpoint, which is modelled separately below and never
 * merged into this cache-able shape.
 */

const nullableIsoDateTime = isoDateTimeSchema.nullable();

export const checklistItemViewSchema = z.object({
  id: z.string(),
  key: z.string(),
  label: z.string(),
  labelFa: z.string(),
  type: checklistItemTypeSchema,
  status: checklistItemStatusSchema,
  isBlocking: z.boolean(),
  sortOrder: z.number().int(),
  hasValue: z.boolean(),
  verifiedByStaffId: z.string().nullable(),
  verifiedAt: nullableIsoDateTime,
  note: z.string().nullable(),
  isOperatorEditable: z.boolean(),
});
export type ChecklistItemView = z.infer<typeof checklistItemViewSchema>;

export const checklistViewSchema = z.object({
  id: z.string(),
  workItemId: z.string(),
  templateId: z.string().nullable(),
  status: checklistStatusSchema,
  blockedReason: z.string().nullable(),
  completedAt: nullableIsoDateTime,
  isLocked: z.boolean(),
  items: z.array(checklistItemViewSchema),
});
export type ChecklistView = z.infer<typeof checklistViewSchema>;

export const giftCardAssetViewSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  fulfillmentId: z.string().nullable(),
  skuId: z.string().nullable(),
  assetType: deliveryAssetTypeSchema,
  maskedCode: z.string().nullable(),
  hasPin: z.boolean(),
  serialNumber: z.string().nullable(),
  deliveryUrl: z.string().nullable(),
  recipientEmailMasked: z.string().nullable(),
  expiryDate: nullableIsoDateTime,
  supplierReference: z.string().nullable(),
  status: deliveryStatusSchema,
  enteredByUserId: z.string().nullable(),
  enteredAt: nullableIsoDateTime,
  sentAt: nullableIsoDateTime,
  accessCount: z.number().int(),
  lastAccessedAt: nullableIsoDateTime,
});
export type GiftCardAssetView = z.infer<typeof giftCardAssetViewSchema>;

export const COST_VARIANCE_REASON_VALUES = [
  "WITHIN_TOLERANCE",
  "ABOVE_TOLERANCE",
  "NO_BASELINE",
  "CURRENCY_MISMATCH",
] as const;
export type CostVarianceReason = (typeof COST_VARIANCE_REASON_VALUES)[number];

export const costVarianceSchema = z.object({
  varianceBps: z.number().int().nullable(),
  toleranceBps: z.number().int(),
  requiresApproval: z.boolean(),
  reason: z.enum(COST_VARIANCE_REASON_VALUES),
});
export type CostVarianceAssessment = z.infer<typeof costVarianceSchema>;

export const SEND_BLOCKER_VALUES = [
  "CHECKLIST_LOCKED",
  "PAYMENT_NOT_VERIFIED",
  "ORDER_NOT_DELIVERABLE",
  "ASSET_MISSING",
  "ACTUAL_COST_MISSING",
  "COST_VARIANCE_UNAPPROVED",
  "CHECKLIST_INCOMPLETE",
  "DELIVERY_EMAIL_MISSING",
] as const;
export type SendBlocker = (typeof SEND_BLOCKER_VALUES)[number];

export const fulfillmentWorkspaceSchema = z.object({
  workItemId: z.string(),
  orderId: z.string(),
  checklist: checklistViewSchema,
  assets: z.array(giftCardAssetViewSchema),
  costVariance: costVarianceSchema.nullable(),
  sendBlockers: z.array(z.enum(SEND_BLOCKER_VALUES)),
  canSend: z.boolean(),
});
export type FulfillmentWorkspace = z.infer<typeof fulfillmentWorkspaceSchema>;

const workspaceEnvelopeSchema = z.object({ workspace: fulfillmentWorkspaceSchema });

export const deliveryOutcomeSchema = z.object({
  delivered: z.boolean(),
  assetId: z.string(),
  attemptNumber: z.number().int(),
  failureCode: z.string().nullable(),
  workspace: fulfillmentWorkspaceSchema,
});
export type DeliveryOutcome = z.infer<typeof deliveryOutcomeSchema>;

/**
 * The reveal response. Deliberately NOT part of any other schema: this value is
 * rendered once and dropped, never persisted, cached, logged or put in a URL.
 */
const revealedSecretSchema = z.object({
  secret: z.object({
    assetType: deliveryAssetTypeSchema,
    code: z.string().optional(),
    pin: z.string().optional(),
    deliveryUrl: z.string().optional(),
  }),
});
export type RevealedSecret = z.infer<typeof revealedSecretSchema>["secret"];

/** Discriminated union — `code` is rejected, not merely ignored, for URL types. */
export type AssetInput =
  | { assetType: "CODE"; code: string; serialNumber?: string; expiryDate?: string }
  | { assetType: "CODE_PIN"; code: string; pin: string; serialNumber?: string; expiryDate?: string }
  | { assetType: "URL"; deliveryUrl: string; expiryDate?: string }
  | { assetType: "PROVIDER_DIRECT_EMAIL"; recipientEmail: string };

export interface RecordSupplierResultInput {
  readonly asset: AssetInput;
  readonly supplierReference?: string;
  readonly actualSupplierCost?: string;
  readonly actualSupplierCurrency?: string;
  readonly idempotencyKey?: string;
}

function base(workItemId: string): string {
  return `/api/operator/fulfillment/${encodeURIComponent(workItemId)}`;
}

export const fulfillment = {
  getWorkspace: async (workItemId: string) =>
    (await api.get(base(workItemId), workspaceEnvelopeSchema)).workspace,

  checkItem: async (workItemId: string, itemKey: string, checked: boolean, note?: string) =>
    (
      await api.post(
        `${base(workItemId)}/checklist/check`,
        { itemKey, checked, ...(note ? { note } : {}) },
        workspaceEnvelopeSchema,
      )
    ).workspace,

  setField: async (workItemId: string, itemKey: string, value: string) =>
    (await api.post(`${base(workItemId)}/checklist/field`, { itemKey, value }, workspaceEnvelopeSchema)).workspace,

  recordSupplierResult: async (workItemId: string, input: RecordSupplierResultInput) =>
    (await api.post(`${base(workItemId)}/supplier-result`, input, workspaceEnvelopeSchema)).workspace,

  approveCostVariance: async (workItemId: string, reason: string) =>
    (await api.post(`${base(workItemId)}/approve-cost-variance`, { reason }, workspaceEnvelopeSchema)).workspace,

  send: (workItemId: string) =>
    api.post(`${base(workItemId)}/send`, {}, z.object({ outcome: deliveryOutcomeSchema })),

  retryDelivery: (workItemId: string) =>
    api.post(`${base(workItemId)}/retry-delivery`, {}, z.object({ outcome: deliveryOutcomeSchema })),

  reopen: async (workItemId: string, reason: string) =>
    (await api.post(`${base(workItemId)}/reopen`, { reason }, workspaceEnvelopeSchema)).workspace,

  /**
   * The ONE call in the product that returns a gift-card plaintext. Every
   * invocation writes a GIFT_CARD_CODE_VIEWED audit entry against the operator,
   * so it may only ever be triggered by a deliberate click with a typed reason.
   */
  revealAsset: async (workItemId: string, assetId: string, reason: string) =>
    (
      await api.post(
        `${base(workItemId)}/assets/${encodeURIComponent(assetId)}/reveal`,
        { reason },
        revealedSecretSchema,
      )
    ).secret,
};

/* ============================================================================
 * Vocabulary
 * ==========================================================================*/

export const SEND_BLOCKER_LABEL: Record<SendBlocker, string> = {
  CHECKLIST_LOCKED: "این سفارش قبلاً ارسال شده و چک‌لیست قفل است.",
  PAYMENT_NOT_VERIFIED: "پرداخت سفارش هنوز تأیید نشده است.",
  ORDER_NOT_DELIVERABLE: "وضعیت سفارش اجازهٔ تحویل نمی‌دهد.",
  ASSET_MISSING: "هنوز نتیجهٔ تأمین‌کننده ثبت نشده است.",
  ACTUAL_COST_MISSING: "هزینهٔ واقعی تأمین‌کننده ثبت نشده است.",
  COST_VARIANCE_UNAPPROVED: "اختلاف هزینه بیش از حد مجاز است و تأیید مدیر می‌خواهد.",
  CHECKLIST_INCOMPLETE: "موارد الزامی چک‌لیست هنوز تکمیل نشده‌اند.",
  DELIVERY_EMAIL_MISSING: "ایمیل تحویل مشتری ثبت نشده است.",
};

export const COST_VARIANCE_REASON_LABEL: Record<CostVarianceReason, string> = {
  WITHIN_TOLERANCE: "در محدودهٔ مجاز",
  ABOVE_TOLERANCE: "بیش از حد مجاز",
  NO_BASELINE: "مبنای مقایسه‌ای وجود ندارد",
  CURRENCY_MISMATCH: "واحد پول با استعلام یکی نیست",
};

export const CHECKLIST_STATUS_LABEL: Record<ChecklistStatus, string> = {
  INCOMPLETE: "ناقص",
  READY_FOR_REVIEW: "آمادهٔ بازبینی",
  COMPLETED: "تکمیل‌شده",
  BLOCKED: "مسدود",
};

export const CHECKLIST_ITEM_STATUS_LABEL: Record<ChecklistItemStatus, string> = {
  PENDING: "در انتظار",
  PASSED: "تأیید شد",
  FAILED: "ناموفق",
  NOT_APPLICABLE: "بی‌مورد",
  WAITING_APPROVAL: "در انتظار تأیید مدیر",
};

export const CHECKLIST_ITEM_TYPE_LABEL: Record<ChecklistItemType, string> = {
  BOOLEAN: "اپراتور",
  SYSTEM_VERIFIED: "سیستم",
  REQUIRED_FIELD: "فیلد الزامی",
  MANAGER_APPROVAL: "تأیید مدیر",
};

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  NOT_READY: "آماده نیست",
  READY: "آمادهٔ ارسال",
  SENDING: "در حال ارسال",
  SENT: "ارسال شد",
  DELIVERY_FAILED: "ارسال ناموفق",
};

export const DELIVERY_ASSET_TYPE_LABEL: Record<DeliveryAssetType, string> = {
  CODE: "کد",
  CODE_PIN: "کد و پین",
  URL: "لینک بازخرید",
  PROVIDER_DIRECT_EMAIL: "ارسال مستقیم تأمین‌کننده",
};

/** Only these two asset types hold an encrypted secret worth revealing. */
export function hasRevealableSecret(assetType: DeliveryAssetType): boolean {
  return assetType === "CODE" || assetType === "CODE_PIN";
}

/**
 * Roles the API accepts for `approve-cost-variance` and `reopen`
 * (MANAGER_APPROVAL_ROLE_SET). Used only to decide what to draw — the server
 * re-checks, and additionally refuses an approver who holds the claim.
 */
export const COST_VARIANCE_APPROVER_ROLES = ["ADMIN", "OPS_MANAGER", "MANAGEMENT"] as const;

export function canApproveCostVariance(role: StaffRole | null | undefined): boolean {
  return hasRole(role, COST_VARIANCE_APPROVER_ROLES);
}
