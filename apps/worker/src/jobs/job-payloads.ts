import { z } from 'zod';

/**
 * Runtime validation for sweep job payloads.
 *
 * The scheduler only ever enqueues `{}`, so every override here is a manual or
 * test enqueue. A payload is still data read back from Redis, and several of the
 * overrides are safety rails: a `maxAttempts` of 10^9 would switch off the
 * point at which a human takes over a failing delivery, and a `now` in the
 * future would expire quotes customers are still allowed to accept. Overrides
 * may therefore only make a sweep *more* conservative than its defaults, never
 * less — the defaults themselves are unchanged.
 */

/** Tolerated forward drift of a pinned clock against this process's clock. */
const MAX_FUTURE_SKEW_MS = 60_000;

const positiveInt = (max: number) => z.number().int().min(1).max(max);

const isoInstant = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), { message: 'invalid `now`' });

/**
 * Resolves the optional pinned clock; rejects one that runs ahead of real time.
 * `reference` is what "real time" means for the sweep — this process's clock
 * unless the sweep reads the database's.
 */
export function resolveNow(
  pinned: string | undefined,
  queue: string,
  reference: Date = new Date(),
): Date {
  if (pinned === undefined) {
    return reference;
  }
  const now = new Date(pinned);
  if (Number.isNaN(now.getTime())) {
    throw new Error(`${queue}: invalid \`now\``);
  }
  if (now.getTime() > reference.getTime() + MAX_FUTURE_SKEW_MS) {
    throw new Error(`${queue}: \`now\` may not be in the future`);
  }
  return now;
}

export const quoteExpiryPayloadSchema = z
  .object({
    now: isoInstant.optional(),
    batchSize: positiveInt(5_000).optional(),
  })
  .strict();

export const abandonmentScanPayloadSchema = z
  .object({
    now: isoInstant.optional(),
    cartIdleMinutes: positiveInt(60 * 24 * 365).optional(),
    quoteIdleMinutes: positiveInt(60 * 24 * 365).optional(),
    batchSize: positiveInt(5_000).optional(),
  })
  .strict();

export function deliveryRetryPayloadSchema(defaults: {
  readonly maxAttempts: number;
  readonly minRetryDelayMinutes: number;
}) {
  return z
    .object({
      now: isoInstant.optional(),
      // May only lower the cap: past it, a human owns the delivery.
      maxAttempts: positiveInt(defaults.maxAttempts).optional(),
      // May only lengthen the cool-down: shorter means mailing the customer faster.
      minRetryDelayMinutes: z
        .number()
        .int()
        .min(defaults.minRetryDelayMinutes)
        .max(60 * 24 * 30)
        .optional(),
      batchSize: positiveInt(500).optional(),
    })
    .strict();
}

/** Parses a payload, surfacing field names only — never the offending values. */
export function parsePayload<T>(schema: z.ZodType<T>, data: unknown, queue: string): T {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join('.') || '(root)').join(',');
    throw new Error(`${queue}: invalid job payload (${fields})`);
  }
  return result.data;
}
