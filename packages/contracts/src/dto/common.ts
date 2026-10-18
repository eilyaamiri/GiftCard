import { z } from 'zod';

/* ============================================================================
 * Primitives
 * ==========================================================================*/

/** Every primary key in the schema is a cuid. */
export const idSchema = z.string().min(1).max(64);

/** ISO-8601 timestamp with offset. All API timestamps are UTC. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

/**
 * Client-supplied idempotency key.
 *
 * Required for payment creation, quote acceptance, order creation and
 * fulfillment (AGENTS.md rule 9). Replaying the same key must return the
 * original result, never create a second record.
 */
export const idempotencyKeySchema = z
  .string()
  .min(16, 'Idempotency key must be at least 16 characters')
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u, 'Idempotency key must be URL-safe');

/** Opaque anonymous commerce session token (pre-login funnel tracking). */
export const commerceSessionTokenSchema = z.string().min(16).max(128);

/* ============================================================================
 * Pagination
 * ==========================================================================*/

export const paginationRequestSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});
export type PaginationRequest = z.infer<typeof paginationRequestSchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** Build a typed paginated response schema for any item schema. */
export function paginatedSchema<TItem extends z.ZodTypeAny>(item: TItem) {
  return z.object({
    items: z.array(item),
    meta: paginationMetaSchema,
  });
}

/* ============================================================================
 * Errors
 * ==========================================================================*/

/**
 * The only error shape any Barat API endpoint returns.
 *
 * `code` is a stable machine key the frontend switches on. `message` is a safe,
 * customer-facing Persian sentence. A raw provider message, stack trace, SQL
 * error or merchant identifier NEVER appears here — see the global exception
 * filter in apps/api/src/common/filters.
 */
export const apiErrorSchema = z.object({
  statusCode: z.number().int(),
  code: z.string(),
  message: z.string(),
  details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  requestId: z.string().optional(),
  timestamp: isoDateTimeSchema,
});
export type ApiError = z.infer<typeof apiErrorSchema>;

/** Stable error codes shared by the API and both frontends. */
export const API_ERROR_CODE_VALUES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'REQUEST_TIMEOUT',
  'SERVICE_UNAVAILABLE',
  'IDEMPOTENCY_CONFLICT',
  'QUOTE_EXPIRED',
  'QUOTE_ALREADY_ACCEPTED',
  'FX_RATE_STALE',
  'FX_RATE_UNAVAILABLE',
  'AMOUNT_MISMATCH',
  'PAYMENT_PROVIDER_UNAVAILABLE',
  'PAYMENT_VERIFICATION_FAILED',
  'FEATURE_DISABLED',
  'SUPPLIER_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODE_VALUES)[number];
export const apiErrorCodeSchema = z.enum(API_ERROR_CODE_VALUES);

/* ============================================================================
 * Actor context
 * ==========================================================================*/

/** Who performed an action, for audit rows and structured logs. */
export const actorRefSchema = z.object({
  type: z.enum(['CUSTOMER', 'STAFF', 'SYSTEM', 'ANONYMOUS']),
  id: idSchema.nullable(),
  role: z.string().nullable(),
});
export type ActorRef = z.infer<typeof actorRefSchema>;

/* ============================================================================
 * Advertised delivery time
 * ==========================================================================*/

/**
 * The delivery times an operator may promise on a product page, in minutes.
 *
 * One list, read by the admin dropdown, the API's write validation and the
 * storefront label, so the three can never drift apart. `0` is «آنی». A
 * product with no value set shows no delivery line at all.
 *
 * This is a promise shown to the customer before they pay, not a measured SLA:
 * nothing schedules, times out or refunds against it.
 */
export const DELIVERY_TIME_PRESETS = [
  { minutes: 0, labelFa: 'آنی' },
  { minutes: 15, labelFa: 'حدود ۱۵ دقیقه' },
  { minutes: 30, labelFa: 'حدود ۳۰ دقیقه' },
  { minutes: 60, labelFa: 'حدود ۱ ساعت' },
  { minutes: 180, labelFa: 'حدود ۳ ساعت' },
  { minutes: 1440, labelFa: 'حدود ۲۴ ساعت' },
] as const;

const DELIVERY_PRESET_MINUTES: ReadonlySet<number> = new Set(
  DELIVERY_TIME_PRESETS.map((preset) => preset.minutes),
);

/** A delivery time on the wire. Reads accept any non-negative integer; writes are checked against the presets. */
export const deliveryMinutesSchema = z.number().int().min(0);

/** What an admin write may set: one of the presets, or null to show nothing. */
export const deliveryMinutesInputSchema = deliveryMinutesSchema
  .refine((minutes) => DELIVERY_PRESET_MINUTES.has(minutes), {
    message: 'Delivery time must be one of DELIVERY_TIME_PRESETS',
  })
  .nullable();

/** The Persian label for a stored delivery time, or null when there is nothing to show. */
export function deliveryTimeLabelFa(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined) return null;
  return DELIVERY_TIME_PRESETS.find((preset) => preset.minutes === minutes)?.labelFa ?? null;
}
