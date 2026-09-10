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

/**
 * A cost variance is deliberately not in this list.
 *
 * The API stopped emitting `COST_VARIANCE_UNAPPROVED`: an out-of-tolerance spend
 * is now routed to a manager as its own review while the card goes out. Keeping a
 * value here that the server never sends would only invite UI that claims a hold
 * that no longer exists.
 */
export const SEND_BLOCKER_VALUES = [
  "CHECKLIST_LOCKED",
  "PAYMENT_NOT_VERIFIED",
  "ORDER_NOT_DELIVERABLE",
  "ASSET_MISSING",
  "ACTUAL_COST_MISSING",
  "CHECKLIST_INCOMPLETE",
  "DELIVERY_EMAIL_MISSING",
] as const;
export type SendBlocker = (typeof SEND_BLOCKER_VALUES)[number];

/**
 * What the operator needs to make an international payment: where to pay, how
 * much, and which account to sign in to. The password is absent by design —
 * only `hasAccountPassword` says whether one exists; the plaintext comes from
 * the separate reveal call below.
 */
export const internationalPaymentBriefSchema = z.object({
  serviceNameFa: z.string().nullable(),
  payableAmount: z.string().nullable(),
  payableCurrency: z.string(),
  siteUrl: z.string().nullable(),
  accountUsername: z.string().nullable(),
  hasAccountPassword: z.boolean(),
});
export type InternationalPaymentBrief = z.infer<typeof internationalPaymentBriefSchema>;

/** The recorded spend, so a correction can show what it is replacing. */
export const recordedSupplierCostSchema = z.object({
  actualSupplierCost: z.string(),
  actualSupplierCurrency: z.string().nullable(),
});
export type RecordedSupplierCost = z.infer<typeof recordedSupplierCostSchema>;

export const paymentReceiptViewSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  sizeBytes: z.number().int().positive().max(5 * 1024 * 1024),
  uploadedAt: isoDateTimeSchema,
});
export type PaymentReceiptView = z.infer<typeof paymentReceiptViewSchema>;

export const fulfillmentWorkspaceSchema = z.object({
  workItemId: z.string(),
  orderId: z.string(),
  checklist: checklistViewSchema,
  assets: z.array(giftCardAssetViewSchema),
  supplierCost: recordedSupplierCostSchema.nullable(),
  costVariance: costVarianceSchema.nullable(),
  sendBlockers: z.array(z.enum(SEND_BLOCKER_VALUES)),
  canSend: z.boolean(),
  internationalPayment: internationalPaymentBriefSchema.nullable(),
  paymentReceipt: paymentReceiptViewSchema.nullable(),
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

/** Same rule as `revealedSecretSchema`: shown once, kept out of every cache. */
const revealedCredentialSchema = z.object({
  credential: z.object({ accountPassword: z.string() }),
});

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

/** The price on its own, for an order whose card is already stored. */
export interface RecordActualCostInput {
  readonly actualSupplierCost: string;
  readonly actualSupplierCurrency?: string;
  readonly supplierReference?: string;
}

/** A replacement for a price already on file. The reason is not optional. */
export interface CorrectActualCostInput {
  readonly actualSupplierCost: string;
  readonly actualSupplierCurrency?: string;
  readonly reason: string;
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

  uploadPaymentReceipt: async (workItemId: string, file: File) => {
    const form = new FormData();
    form.append("receipt", file);
    return (
      await api.postForm(`${base(workItemId)}/payment-receipt`, form, workspaceEnvelopeSchema)
    ).workspace;
  },

  /**
   * The price alone. `/supplier-result` refuses to run once an asset exists, so
   * a card entered on a code request has no other way to clear
   * `ACTUAL_COST_MISSING`.
   */
  recordActualCost: async (workItemId: string, input: RecordActualCostInput) =>
    (await api.post(`${base(workItemId)}/actual-cost`, input, workspaceEnvelopeSchema)).workspace,

  /**
   * Rewrites a price the operator typed wrong. Manager-only on the server, and
   * it voids any approval the previous figure had earned.
   */
  correctActualCost: async (workItemId: string, input: CorrectActualCostInput) =>
    (await api.post(`${base(workItemId)}/correct-actual-cost`, input, workspaceEnvelopeSchema)).workspace,

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

  /**
   * The customer's account password for an international payment. Audited the
   * same way as the gift-card reveal, and returned on its own so it can never
   * be folded into the workspace the panel keeps in state.
   */
  revealServiceAccountPassword: async (workItemId: string, reason: string) =>
    (await api.post(`${base(workItemId)}/service-account/reveal`, { reason }, revealedCredentialSchema))
      .credential.accountPassword,
};

/* ============================================================================
 * Vocabulary
 * ==========================================================================*/

export const SEND_BLOCKER_LABEL: Record<SendBlocker, string> = {
  CHECKLIST_LOCKED: "این سفارش قبلاً ارسال شده و چک‌لیست قفل است.",
  PAYMENT_NOT_VERIFIED: "پرداخت سفارش هنوز تأیید نشده است.",
  ORDER_NOT_DELIVERABLE: "وضعیت سفارش اجازهٔ تحویل نمی‌دهد.",
  ASSET_MISSING: "دارایی تحویل هنوز ثبت نشده است؛ آن را در کارت «دارایی تحویل» وارد کنید.",
  ACTUAL_COST_MISSING: "هزینهٔ واقعی تأمین‌کننده ثبت نشده است.",
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
  WAITING_APPROVAL: "در انتظار",
};

export const CHECKLIST_ITEM_TYPE_LABEL: Record<ChecklistItemType, string> = {
  BOOLEAN: "اپراتور",
  SYSTEM_VERIFIED: "سیستم یا اپراتور",
  REQUIRED_FIELD: "فیلد یا اپراتور",
  // Kept only so responses containing a historical enum value can be parsed;
  // manager-only rows are filtered out by the API and are never rendered.
  MANAGER_APPROVAL: "اپراتور",
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
 * Whether the gift-card task offers the operator a form to type the delivery
 * asset in by hand.
 *
 * An operator often already holds the code — bought outside the panel, sent by
 * a supplier over another channel — and then needs neither the provider flow
 * nor an admin code request to finish the order. This decides only what is
 * drawn; the server stays the guard, and it refuses on the same two grounds:
 * an order that already has an asset (creating a second one would mean buying
 * the same card twice) and a checklist that is locked because the card is gone.
 *
 * A payment task is excluded because its form is its own card above the record,
 * not a section of it.
 */
export function canEnterDeliveryAssetManually(workspace: FulfillmentWorkspace): boolean {
  return (
    workspace.internationalPayment === null &&
    workspace.assets.length === 0 &&
    !workspace.checklist.isLocked
  );
}

/**
 * `MANAGER_APPROVAL_ROLE_SET` in the API, mirrored so the panel draws the same
 * permissions the server enforces.
 */
export const MANAGER_ROLES = ["ADMIN", "OPS_MANAGER", "MANAGEMENT"] as const;

/**
 * Roles the API accepts for `approve-cost-variance` and `reopen`. Used only to
 * decide what to draw — the server re-checks, and additionally refuses an
 * approver who holds the claim.
 */
export const COST_VARIANCE_APPROVER_ROLES = MANAGER_ROLES;

export function canApproveCostVariance(role: StaffRole | null | undefined): boolean {
  return hasRole(role, COST_VARIANCE_APPROVER_ROLES);
}

/**
 * Whether this role may rewrite a supplier cost already on record.
 *
 * The same set as approval, and deliberately its own function: an operator may
 * record a spend once but never revise it, because a correction re-derives the
 * variance and drops any approval the old figure had. That is a manager's call,
 * and the API enforces it independently of what this draws.
 */
export function canCorrectSupplierCost(role: StaffRole | null | undefined): boolean {
  return hasRole(role, MANAGER_ROLES);
}

/**
 * Whether this role may work a task it does not hold.
 *
 * `assertCanOperate` early-returns for the manager roles, so the API has always
 * accepted a checklist tick or a send from an admin who never claimed the item.
 * The panel used to gate on the claim alone, which showed an admin a read-only
 * workspace the server would have written to happily — a restriction that
 * existed only in the browser.
 */
export function canOperateWithoutClaim(role: StaffRole | null | undefined): boolean {
  return hasRole(role, MANAGER_ROLES);
}
