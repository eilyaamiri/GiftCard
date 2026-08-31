import { z } from "zod";
import { fxPairSchema, fxProviderHealthSchema, fxRateSnapshotSchema, fxRateStringSchema } from "@barat/contracts";

/**
 * Request/response shapes for `/api/fx/*` that @barat/contracts does not ship.
 *
 * The package carries the FX *response* snapshots (`fxRateSnapshotSchema`,
 * `getFxRateResponseSchema`, `fxProviderHealthSchema`); the history envelope and
 * the override request live in the API module only. They are pinned here to the
 * live responses and reuse the package's schemas for every field they share.
 */
export const fxHistoryResponseSchema = z.object({
  items: z.array(fxRateSnapshotSchema),
  meta: z.object({
    page: z.number().int().min(1),
    pageSize: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  }),
});
export type FxHistoryResponse = z.infer<typeof fxHistoryResponseSchema>;

export const fxProviderHealthResponseSchema = z.object({
  providers: z.array(fxProviderHealthSchema),
});
export type FxProviderHealthResponse = z.infer<typeof fxProviderHealthResponseSchema>;

/** Mirrors the API's `fxOverrideRequestSchema`, including its 60s..24h lifetime bound. */
export const fxOverrideRequestSchema = z
  .object({
    pair: fxPairSchema,
    buyRate: fxRateStringSchema,
    sellRate: fxRateStringSchema,
    midRate: fxRateStringSchema,
    reason: z.string().trim().min(3, "دلیل override باید حداقل ۳ نویسه باشد.").max(500),
    ttlSeconds: z.number().int().min(60).max(86_400),
  })
  .strict();
export type FxOverrideRequest = z.infer<typeof fxOverrideRequestSchema>;

export const fxOverrideClearedSchema = z.object({ expired: z.number().int().min(0) });
export type FxOverrideCleared = z.infer<typeof fxOverrideClearedSchema>;

/** Selectable override lifetimes. The API caps a manual rate at one day. */
export const OVERRIDE_TTL_CHOICES = [
  { seconds: 900, label: "۱۵ دقیقه" },
  { seconds: 1_800, label: "۳۰ دقیقه" },
  { seconds: 3_600, label: "۱ ساعت" },
  { seconds: 14_400, label: "۴ ساعت" },
  { seconds: 86_400, label: "۲۴ ساعت (سقف مجاز)" },
] as const;

export const FX_SOURCE_LABELS: Record<string, string> = {
  API: "دریافت خودکار از Provider",
  SCRAPE: "استخراج از منبع وب",
  MANUAL: "ثبت دستی توسط کارشناس",
};
