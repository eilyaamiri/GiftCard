"use server";

import { simulateQuoteRequestSchema, simulateQuoteResponseSchema } from "@barat/contracts";
import type { SimulateQuoteResponse } from "@barat/contracts";
import { ApiClientError, FINANCIAL_WRITE_ROLES, api } from "@/lib/api";
import { requireRole } from "@/lib/session";

export type SimulateActionResult =
  | { readonly ok: true; readonly response: SimulateQuoteResponse }
  | { readonly ok: false; readonly message: string };

/**
 * The single path from the simulator UI to the pricing engine.
 *
 * It re-checks the role here as well as in the page, because a server action is
 * an independently reachable HTTP endpoint — a page-level guard does not cover
 * it. The API applies its own `@Roles('ADMIN','FINANCE')` on top.
 *
 * No money is computed here. The request is validated, forwarded, and the
 * server's breakdown is returned verbatim.
 */
export async function simulateQuoteAction(input: unknown): Promise<SimulateActionResult> {
  await requireRole(FINANCIAL_WRITE_ROLES);

  const parsed = simulateQuoteRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, message: "ورودی شبیه‌ساز معتبر نیست. مقادیر را بررسی کنید." };
  }

  try {
    const response = await api.post<SimulateQuoteResponse>(
      "/api/pricing/simulate",
      parsed.data,
      simulateQuoteResponseSchema,
    );
    return { ok: true, response };
  } catch (error) {
    if (error instanceof ApiClientError) return { ok: false, message: error.message };
    return { ok: false, message: "ارتباط با موتور قیمت‌گذاری برقرار نشد." };
  }
}
