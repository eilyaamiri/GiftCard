"use server";

import { revalidatePath } from "next/cache";
import type { StaffRole } from "@barat/contracts";
import { fxRateSnapshotSchema, type FxRateSnapshot } from "@barat/contracts";
import { ApiClientError, api } from "@/lib/api";
import { requireRole } from "@/lib/session";
import { fxOverrideClearedSchema, fxOverrideRequestSchema, type FxOverrideCleared } from "./fx-schema";

/**
 * Mirrors the API's `FX_OVERRIDE_ROLES`. It is narrower than the page gate:
 * MANAGEMENT may read the FX screen but may not pin a rate. The API enforces
 * this independently — this only stops the request before it is sent.
 */
const FX_OVERRIDE_ROLES = ["ADMIN", "FINANCE"] as const satisfies readonly StaffRole[];

export type FxOverrideActionResult =
  | { readonly ok: true; readonly snapshot: FxRateSnapshot }
  | { readonly ok: false; readonly message: string };

export type FxClearActionResult =
  | { readonly ok: true; readonly cleared: FxOverrideCleared }
  | { readonly ok: false; readonly message: string };

/**
 * Pin a manual rate. The acting staff member is never taken from the body — the
 * API reads it from the authenticated session and writes the audit entry.
 */
export async function setFxOverrideAction(input: unknown): Promise<FxOverrideActionResult> {
  await requireRole(FX_OVERRIDE_ROLES);

  const parsed = fxOverrideRequestSchema.safeParse(input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, message: first?.message ?? "مقادیر override معتبر نیست." };
  }

  try {
    const snapshot = await api.post<FxRateSnapshot>("/api/fx/override", parsed.data, fxRateSnapshotSchema);
    revalidatePath("/fx");
    return { ok: true, snapshot };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

export async function clearFxOverrideAction(pair: string): Promise<FxClearActionResult> {
  await requireRole(FX_OVERRIDE_ROLES);

  try {
    const cleared = await api.del<FxOverrideCleared>(
      `/api/fx/override?pair=${encodeURIComponent(pair)}`,
      fxOverrideClearedSchema,
    );
    revalidatePath("/fx");
    return { ok: true, cleared };
  } catch (error) {
    return { ok: false, message: toMessage(error) };
  }
}

function toMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "ارتباط با سرویس نرخ ارز برقرار نشد. تغییری ثبت نشد.";
}
