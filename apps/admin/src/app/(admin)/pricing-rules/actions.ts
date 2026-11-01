"use server";

import { revalidatePath } from "next/cache";
import { ApiClientError, FINANCIAL_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import {
  deactivatePricingRuleRequestSchema,
  putPricingRuleRequestSchema,
  putPricingRuleResponseSchema,
  wirePricingRuleSchema,
  type WirePricingRule,
} from "./pricing-rule-schema";

export type PricingRuleActionResult =
  | { readonly ok: true; readonly rule: WirePricingRule }
  | { readonly ok: true; readonly pending: { readonly proposalId: string; readonly reasons: readonly string[] } }
  | { readonly ok: false; readonly message: string };

/**
 * A server action is its own HTTP endpoint, so the role check is repeated here
 * rather than inherited from the page. The API re-decides it a third time.
 *
 * A large change comes back as a proposal (ORD-7): nothing is repriced until a
 * second person approves it.
 */
export async function savePricingRuleAction(input: unknown): Promise<PricingRuleActionResult> {
  await requireRole(FINANCIAL_WRITE_ROLES);

  const parsed = putPricingRuleRequestSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "قاعدهٔ ارسالی معتبر نیست." };
  }

  try {
    const result = await api.put("/api/pricing/rules", parsed.data, putPricingRuleResponseSchema);
    revalidatePath("/pricing-rules");
    return "status" in result ? { ok: true, pending: result } : { ok: true, rule: result };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

/** The second pair of eyes: apply or close someone else's proposal. */
export async function decidePricingProposalAction(input: {
  proposalId: string;
  decision: "approve" | "reject";
}): Promise<{ readonly ok: true } | { readonly ok: false; readonly message: string }> {
  await requireRole(FINANCIAL_WRITE_ROLES);
  if (!/^[0-9a-f-]{36}$/u.test(input.proposalId)) return { ok: false, message: "شناسهٔ پیشنهاد معتبر نیست." };

  try {
    await api.post(`/api/pricing/rules/proposals/${input.proposalId}/${input.decision}`, {});
    revalidatePath("/pricing-rules");
    return { ok: true };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

/**
 * Deactivation is a new version with `isActive: false`, not a delete. The
 * expected version travels with it so two operators editing the same rule
 * cannot silently overwrite each other.
 */
export async function deactivatePricingRuleAction(input: unknown): Promise<PricingRuleActionResult> {
  await requireRole(FINANCIAL_WRITE_ROLES);

  const parsed = deactivatePricingRuleRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "شناسه یا نسخهٔ قاعده معتبر نیست." };
  }

  try {
    const rule = await api.put<WirePricingRule>(
      `/api/pricing/rules/${encodeURIComponent(parsed.data.id)}/deactivate`,
      { expectedVersion: parsed.data.expectedVersion },
      wirePricingRuleSchema,
    );
    revalidatePath("/pricing-rules");
    return { ok: true, rule };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "ارتباط با سرویس قیمت‌گذاری برقرار نشد. تغییری ثبت نشد.";
}
