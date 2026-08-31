import { z } from "zod";
import { idSchema, isoDateTimeSchema, pricingRuleSnapshotSchema } from "@barat/contracts";

/**
 * Wire shapes for `/api/pricing/rules`.
 *
 * `pricingRuleSnapshotSchema` from @barat/contracts already carries every
 * economic field, so only the persistence envelope (scope, versioning window,
 * authorship) is restated here. The API's `PricingRuleScope` is not exported by
 * the contracts package, so the four values are pinned locally.
 */
export const PRICING_RULE_SCOPE_VALUES = ["GLOBAL", "PRODUCT", "SKU", "SERVICE"] as const;
export const pricingRuleScopeSchema = z.enum(PRICING_RULE_SCOPE_VALUES);
export type PricingRuleScope = z.infer<typeof pricingRuleScopeSchema>;

export const PRICING_RULE_SCOPE_LABELS: Record<PricingRuleScope, string> = {
  GLOBAL: "سراسری",
  PRODUCT: "محصول",
  SKU: "SKU",
  SERVICE: "سرویس",
};

export const wirePricingRuleSchema = pricingRuleSnapshotSchema.extend({
  scope: pricingRuleScopeSchema,
  targetId: idSchema.nullable(),
  isActive: z.boolean(),
  effectiveFrom: isoDateTimeSchema,
  effectiveTo: isoDateTimeSchema.nullable(),
  createdByStaffId: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type WirePricingRule = z.infer<typeof wirePricingRuleSchema>;

export const wirePricingRuleListSchema = z.array(wirePricingRuleSchema);

/**
 * Mirrors the API's `putPricingRuleRequestSchema`, including its two refusals:
 * a GLOBAL rule may not name a target, and the rounding step must be a whole
 * Toman. Validating client-side too means the operator sees the problem next to
 * the field instead of as a 400 after the confirmation step.
 */
export const putPricingRuleRequestSchema = pricingRuleSnapshotSchema
  .omit({ id: true, version: true })
  .extend({
    scope: pricingRuleScopeSchema,
    targetId: idSchema.nullable(),
    expectedVersion: z.number().int().min(1).optional(),
    isActive: z.boolean(),
  })
  .superRefine((value, context) => {
    if (value.scope === "GLOBAL" && value.targetId !== null) {
      context.addIssue({ code: "custom", path: ["targetId"], message: "قاعدهٔ سراسری نباید هدف مشخص داشته باشد." });
    }
    if (value.scope !== "GLOBAL" && value.targetId === null) {
      context.addIssue({ code: "custom", path: ["targetId"], message: "قاعدهٔ غیرسراسری باید هدف داشته باشد." });
    }
    const roundingStepIrr = BigInt(value.roundingStepIrr);
    if (roundingStepIrr <= 0n) {
      context.addIssue({ code: "custom", path: ["roundingStepIrr"], message: "پلهٔ گرد کردن باید بزرگ‌تر از صفر باشد." });
    } else if (roundingStepIrr % 10n !== 0n) {
      context.addIssue({
        code: "custom",
        path: ["roundingStepIrr"],
        message: "پلهٔ گرد کردن باید مضربی از ۱۰ ریال (یک تومان کامل) باشد.",
      });
    }
  });
export type PutPricingRuleRequest = z.input<typeof putPricingRuleRequestSchema>;

export const deactivatePricingRuleRequestSchema = z.object({
  id: idSchema,
  expectedVersion: z.number().int().min(1),
});
export type DeactivatePricingRuleRequest = z.infer<typeof deactivatePricingRuleRequestSchema>;

/** The editable economic fields, in the order the form and the diff present them. */
export const BPS_FIELDS = [
  { key: "fxSpreadBps", label: "اسپرد نرخ ارز" },
  { key: "fxRiskBufferBps", label: "بافر ریسک نرخ ارز" },
  { key: "serviceFeeBps", label: "کارمزد سرویس" },
  { key: "paymentFeeBps", label: "کارمزد درگاه پرداخت" },
  { key: "targetMarginBps", label: "حاشیهٔ سود هدف" },
  { key: "maxSupplierCostToleranceBps", label: "سقف تلورانس هزینهٔ تأمین‌کننده" },
] as const;
export type BpsFieldKey = (typeof BPS_FIELDS)[number]["key"];

export const IRR_FIELDS = [
  { key: "serviceFeeFixedIrr", label: "کارمزد ثابت سرویس" },
  { key: "operationalFeeIrr", label: "هزینهٔ عملیاتی ثابت" },
  { key: "paymentFeeFixedIrr", label: "کارمزد ثابت درگاه" },
  { key: "minimumMarginIrr", label: "کف حاشیهٔ سود" },
  { key: "roundingStepIrr", label: "پلهٔ گرد کردن مبلغ نهایی" },
] as const;
export type IrrFieldKey = (typeof IRR_FIELDS)[number]["key"];
