import { describe, expect, it } from "vitest";

import {
  PRICING_RULE_SCOPE_LABELS,
  PRICING_RULE_SCOPE_VALUES,
  pricingRuleScopeSchema,
  putPricingRuleRequestSchema,
} from "./pricing-rule-schema";

/**
 * The economics of a rule are validated by the engine's own tests. What is
 * pinned here is the envelope this screen sends, and the one case that used to
 * be impossible to save: the null-target `TOP_UP_GAME` fallback the seeded 5%
 * direct top-up margin is stored as.
 */
const baseRule = {
  name: "Direct top-up margin (5%)",
  isActive: true,
  quoteTtlSeconds: 600,
  fxSpreadBps: 150,
  fxRiskBufferBps: 100,
  serviceFeeBps: 200,
  serviceFeeFixedIrr: "0",
  operationalFeeIrr: "0",
  targetMarginBps: 500,
  minimumMarginIrr: "0",
  paymentFeeBps: 100,
  paymentFeeFixedIrr: "0",
  roundingStepIrr: "10000",
  maxSupplierCostToleranceBps: 500,
} as const;

function parse(overrides: Record<string, unknown>) {
  return putPricingRuleRequestSchema.safeParse({ ...baseRule, ...overrides });
}

describe("scope vocabulary", () => {
  it("covers every scope the contracts package ships, including the top-up one", () => {
    expect(PRICING_RULE_SCOPE_VALUES).toContain("TOP_UP_GAME");
    expect([...PRICING_RULE_SCOPE_VALUES].sort()).toEqual(
      [...pricingRuleScopeSchema.options].sort(),
    );
  });

  it("has a Persian label for every scope", () => {
    for (const scope of PRICING_RULE_SCOPE_VALUES) {
      expect(PRICING_RULE_SCOPE_LABELS[scope]).toBeTruthy();
    }
  });
});

describe("putPricingRuleRequestSchema", () => {
  it("accepts the seeded falling-back top-up rule with a null target", () => {
    const result = parse({ scope: "TOP_UP_GAME", targetId: null });
    expect(result.success).toBe(true);
  });

  it("also accepts a top-up rule aimed at one game", () => {
    const result = parse({ scope: "TOP_UP_GAME", targetId: "game_123" });
    expect(result.success).toBe(true);
  });

  it("refuses a null target for every scope that has a target concept", () => {
    for (const scope of ["PRODUCT", "SKU", "SERVICE"] as const) {
      const result = parse({ scope, targetId: null });
      expect(result.success, scope).toBe(false);
    }
  });

  it("still refuses a target on a GLOBAL rule", () => {
    expect(parse({ scope: "GLOBAL", targetId: "game_123" }).success).toBe(false);
    expect(parse({ scope: "GLOBAL", targetId: null }).success).toBe(true);
  });

  it("keeps the whole-Toman rounding-step rule", () => {
    expect(parse({ scope: "GLOBAL", targetId: null, roundingStepIrr: "10005" }).success).toBe(false);
    expect(parse({ scope: "GLOBAL", targetId: null, roundingStepIrr: "0" }).success).toBe(false);
  });
});
