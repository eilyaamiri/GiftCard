import { z } from "zod";
import {
  PRICING_RULE_SCOPE_VALUES,
  idSchema,
  isoDateTimeSchema,
  pricingRuleScopeSchema,
  pricingRuleSnapshotSchema,
} from "@barat/contracts";

/**
 * Wire shapes for `/api/pricing/rules`.
 *
 * `pricingRuleSnapshotSchema` from @barat/contracts already carries every
 * economic field, so only the persistence envelope (scope, versioning window,
 * authorship) is restated here.
 *
 * The scope enum is re-exported straight from the contracts package rather than
 * restated. It was previously pinned to four values locally, which silently
 * dropped `TOP_UP_GAME` — the scope the seeded direct top-up margin is stored
 * on — so the API returned that rule and this schema refused to parse it,
 * making the 5% rate uneditable from the only screen that can change it. A
 * local copy can drift the same way again; the shared enum cannot.
 */
export { PRICING_RULE_SCOPE_VALUES, pricingRuleScopeSchema };
export type PricingRuleScope = z.infer<typeof pricingRuleScopeSchema>;

/**
 * Persian labels for every scope in the vocabulary, including ones no screen
 * offers yet. Exhaustive on purpose: a new scope in contracts fails typecheck
 * here instead of rendering as an empty domain name.
 */
export const PRICING_RULE_SCOPE_LABELS: Record<PricingRuleScope, string> = {
  GLOBAL: "سراسری",
  PRODUCT: "محصول",
  SKU: "SKU",
  SERVICE: "سرویس",
  TOP_UP_GAME: "بازی (شارژ مستقیم)",
};

/**
 * The scopes an operator may pick, and the target each one demands.
 *
 * `PRODUCT` and `SKU` are absent deliberately: the API would accept them, but
 * a new rule needs a real target id and this form is launched from an existing
 * rule, not from a product page, so it has nothing to offer for the picker. The
 * wire schemas still parse them, so a rule that already exists on those scopes
 * keeps loading and rendering instead of dropping out of the list.
 *
 * `targetId: "none"` is the fallback case and only `TOP_UP_GAME` has one: the
 * seeded 5% top-up margin is stored with a null target, which is what makes it
 * apply to every game. It is also the case the API accepts for that scope
 * alone (apps/api pricing-rule.service.ts), and the rows already in the table
 * are all null-target by construction.
 */
export const PRICING_RULE_SCOPE_OPTIONS = [
  { value: "TOP_UP_GAME", label: PRICING_RULE_SCOPE_LABELS.TOP_UP_GAME, targetId: "none" },
  { value: "GLOBAL", label: PRICING_RULE_SCOPE_LABELS.GLOBAL, targetId: "none" },
  { value: "SERVICE", label: PRICING_RULE_SCOPE_LABELS.SERVICE, targetId: "required" },
] as const satisfies readonly {
  readonly value: PricingRuleScope;
  readonly label: string;
  readonly targetId: "none" | "required";
}[];

export type PricingRuleScopeOption = (typeof PRICING_RULE_SCOPE_OPTIONS)[number];

export function scopeOptionFor(
  scope: PricingRuleScope,
): PricingRuleScopeOption | undefined {
  return PRICING_RULE_SCOPE_OPTIONS.find((option) => option.value === scope);
}

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
 * Mirrors the API's `putPricingRuleRequestSchema`, including its three refusals:
 * a GLOBAL rule may not name a target, a non-global/non-top-up rule must name
 * one, and the rounding step must be a whole Toman. Validating client-side too
 * means the operator sees the problem next to the field instead of as a 400
 * after the confirmation step.
 *
 * `TOP_UP_GAME` is the one scope where a null `targetId` is legal: it is the
 * fallback that prices every game. The seeded 5% rule is stored that way, so
 * refusing it here would make that rule unsavable. A top-up rule may also name
 * a single game, which is why this is an allowance rather than a requirement.
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
    if (value.scope !== "GLOBAL" && value.scope !== "TOP_UP_GAME" && value.targetId === null) {
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
