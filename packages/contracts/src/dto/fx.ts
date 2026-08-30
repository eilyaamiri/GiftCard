import { z } from 'zod';

import { fxPairSchema } from '../enums/finance';
import { decimalStringSchema, fxRateStringSchema } from '../money/schemas';
import { idSchema, isoDateTimeSchema } from './common';

/**
 * A point-in-time FX observation.
 *
 * Every quote embeds one of these verbatim. We must be able to answer, months
 * later, "which rate, from which provider, observed when, did this order use?"
 * without recomputing anything (AGENTS.md rule 4).
 */
export const fxRateSnapshotSchema = z.object({
  /** `FxRate.id`, null when the rate came from a manual admin override draft. */
  id: idSchema.nullable(),
  pair: fxPairSchema,

  /** IRR per 1 USD, as observed. No spread, no buffer. */
  buyRate: fxRateStringSchema,
  sellRate: fxRateStringSchema,
  midRate: fxRateStringSchema,

  /** Logical provider name, e.g. `primary-nav`, `secondary-tgju`, `manual`. */
  provider: z.string().min(1),
  /** How the value arrived: `API`, `SCRAPE`, `MANUAL`. */
  source: z.string().min(1),

  /** When the provider produced the value. */
  receivedAt: isoDateTimeSchema,
  /** From when the rate may be used. */
  effectiveAt: isoDateTimeSchema,
  /** After this the rate is stale and must not price a new quote. */
  expiresAt: isoDateTimeSchema.nullable(),

  /**
   * True when an admin pinned the rate by hand. Always audited, always surfaced
   * in the admin UI with an explicit "override active" warning.
   */
  isManualOverride: z.boolean(),
  overrideReason: z.string().nullable(),

  /** Age in seconds at the moment the snapshot was taken. */
  ageSeconds: z.number().int().min(0),
  /** `ageSeconds > FX_STALE_THRESHOLD_SECONDS`. A stale rate rejects the quote. */
  isStale: z.boolean(),
});
export type FxRateSnapshot = z.infer<typeof fxRateSnapshotSchema>;

/** Health of the FX aggregator, surfaced on the admin dashboard. */
export const fxProviderHealthSchema = z.object({
  provider: z.string().min(1),
  isHealthy: z.boolean(),
  lastSuccessAt: isoDateTimeSchema.nullable(),
  lastErrorAt: isoDateTimeSchema.nullable(),
  /** Normalised reason; never the raw provider error text. */
  lastErrorCode: z.string().nullable(),
  consecutiveFailures: z.number().int().min(0),
});
export type FxProviderHealth = z.infer<typeof fxProviderHealthSchema>;

/** Current effective rate response for the admin/pricing UI. */
export const getFxRateResponseSchema = z.object({
  snapshot: fxRateSnapshotSchema,
  /** After spread and risk buffer are applied. */
  effectiveRate: decimalStringSchema,
  providers: z.array(fxProviderHealthSchema),
});
export type GetFxRateResponse = z.infer<typeof getFxRateResponseSchema>;
