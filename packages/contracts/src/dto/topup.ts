import { z } from 'zod';

import { serviceFieldTypeSchema } from '../enums/commerce';
import { topUpEventTypeSchema, topUpStatusSchema } from '../enums/operations';
import { positiveDecimalStringSchema } from '../money/schemas';
import { idSchema, isoDateTimeSchema } from './common';

/* ============================================================================
 * Direct top-up
 *
 * A top-up charges the customer's own game account at the supplier. It is not a
 * gift card: there is no code to reveal, and — per the product owner's rule —
 * no operator task is created while the automated flow is working. The trace
 * below is what an operator reads when they need to investigate an order.
 * ==========================================================================*/

/** One input the customer must supply, e.g. `player_id` or `server`. */
export const topUpFieldDtoSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  labelFa: z.string().nullable(),
  fieldType: serviceFieldTypeSchema,
  isRequired: z.boolean(),
  /** `[{ label, value }]` for a SELECT. */
  options: z
    .array(z.object({ label: z.string().min(1), value: z.string().min(1) }))
    .nullable(),
  validationRegex: z.string().nullable(),
  helpTextFa: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type TopUpFieldDto = z.infer<typeof topUpFieldDtoSchema>;

/**
 * One purchasable item, e.g. «60 UC» or «Premium 3 months».
 *
 * Identified by `id` and never by price: the supplier lists many offers that
 * share a price with a sibling, so price is not an identifier.
 */
export const topUpOfferDtoSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  nameFa: z.string().nullable(),
  isAvailable: z.boolean(),
  sortOrder: z.number().int(),
});
export type TopUpOfferDto = z.infer<typeof topUpOfferDtoSchema>;

/** The list-page shape: enough to render a card, without the offer table. */
export const topUpGameSummarySchema = z.object({
  id: idSchema,
  slug: z.string().min(1),
  name: z.string().min(1),
  nameFa: z.string().nullable(),
  brandName: z.string().nullable(),
  region: z.string().nullable(),
  imageUrl: z.string().nullable(),
  /**
   * Lowest available offer cost, for a «from» label. This is what WE pay the
   * supplier, shown only as a relative indicator; it is never a payable price
   * and never the customer's price.
   */
  fromCostAmount: positiveDecimalStringSchema.nullable(),
  fromCostCurrency: z.string().regex(/^[A-Z]{3}$/u).nullable(),
  offerCount: z.number().int().min(0),
});
export type TopUpGameSummary = z.infer<typeof topUpGameSummarySchema>;

/** The detail-page shape: the account form plus everything purchasable. */
export const topUpGameDetailSchema = topUpGameSummarySchema.extend({
  providerNote: z.string().nullable(),
  descriptionFa: z.string().nullable(),
  /** The account form, in display order. Empty for games needing no input. */
  fields: z.array(topUpFieldDtoSchema),
  offers: z.array(topUpOfferDtoSchema),
});
export type TopUpGameDetail = z.infer<typeof topUpGameDetailSchema>;

/**
 * `GET /api/catalog/top-ups` — the games section of the storefront.
 *
 * An empty list is the honest answer when nothing is on sale, so an inactive
 * supplier or an uncurated catalogue produces `{ items: [] }` and never an
 * error. A storefront that had to distinguish "empty" from "broken" would be a
 * storefront that shows a customer a 500 for a commercial decision.
 */
export const listTopUpGamesResponseSchema = z.object({ items: z.array(topUpGameSummarySchema) });
export type ListTopUpGamesResponse = z.infer<typeof listTopUpGamesResponseSchema>;

/** `GET /api/catalog/top-ups/:slug`. A game that is not sellable is a 404. */
export const getTopUpGameResponseSchema = z.object({ game: topUpGameDetailSchema });
export type GetTopUpGameResponse = z.infer<typeof getTopUpGameResponseSchema>;

/* ============================================================================
 * Customer-facing status
 * ==========================================================================*/

/**
 * How a top-up reads to the customer.
 *
 * Derived from the internal `TopUpStatus` on purpose, and deliberately coarser:
 * `WAITING_FUNDS` and `PURCHASING` are both just «in progress», and `UNKNOWN`
 * reads exactly like `FAILED` from the outside because the customer can act on
 * neither. Separating them would leak internal supply-side detail.
 */
export const TOP_UP_CUSTOMER_STATUS_VALUES = [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
] as const;

export const topUpCustomerStatusSchema = z.enum(TOP_UP_CUSTOMER_STATUS_VALUES);
export type TopUpCustomerStatus = z.infer<typeof topUpCustomerStatusSchema>;

/** Never a raw supplier status string and never an internal failure code. */
export const topUpDisplayStatusSchema = z.object({
  /** Machine-readable, safe to branch on in the UI. */
  status: topUpCustomerStatusSchema,
  /** Persian, ready to render. The UI holds no mapping of its own. */
  titleFa: z.string().min(1),
  descriptionFa: z.string().min(1),
});
export type TopUpDisplayStatus = z.infer<typeof topUpDisplayStatusSchema>;

/* ============================================================================
 * Order detail — the customer's view of one top-up
 * ==========================================================================*/

/**
 * The optional top-up block on a customer's order detail.
 *
 * It exposes WHAT was bought and the account it was credited to, so the
 * customer can confirm the identifier they typed. It never carries a raw
 * `failureCode`, a supplier status string, a provider reference or a balance:
 * those are operational detail and go to the admin trace only.
 */
export const orderTopUpDetailSchema = z.object({
  game: z.object({
    id: idSchema,
    slug: z.string().min(1),
    name: z.string().min(1),
    nameFa: z.string().nullable(),
    imageUrl: z.string().nullable(),
  }),
  offer: z.object({
    id: idSchema,
    name: z.string().min(1),
    nameFa: z.string().nullable(),
  }),
  /**
   * What the supplier confirmed it credited, e.g. `player_id=5001234567`. Null
   * until the purchase succeeds. A public game identifier, never a credential.
   */
  accountReference: z.string().nullable(),
  /** The account fields the customer submitted, with values redacted to null. */
  accountFieldKeys: z.array(z.string()),
  status: topUpDisplayStatusSchema,
});
export type OrderTopUpDetail = z.infer<typeof orderTopUpDetailSchema>;

/* ============================================================================
 * Admin trace
 *
 * Read by a person investigating an order. Read-only by design: the operator
 * acts on the fulfillment, not on the trace.
 * ==========================================================================*/

/** One append-only step. `detail` is redacted before it is written. */
export const topUpEventDtoSchema = z.object({
  id: idSchema,
  type: topUpEventTypeSchema,
  /** The fulfillment's status immediately after this event. */
  status: topUpStatusSchema,
  providerStatus: z.string().nullable(),
  failureCode: z.string().nullable(),
  detail: z.record(z.string(), z.unknown()).nullable(),
  actorType: z.string().min(1),
  staffUserId: idSchema.nullable(),
  note: z.string().nullable(),
  createdAt: isoDateTimeSchema,
});
export type TopUpEventDto = z.infer<typeof topUpEventDtoSchema>;

/** The fulfillment row behind one order: the status an operator reads. */
export const topUpFulfillmentDtoSchema = z.object({
  id: idSchema,
  orderId: idSchema,
  providerSku: z.string().min(1),
  /** Exactly what was sent to the supplier as the account identifier. */
  accountFields: z.record(z.string(), z.string()),
  accountReference: z.string().nullable(),
  status: topUpStatusSchema,
  providerStatus: z.string().nullable(),
  failureCode: z.string().nullable(),
  chargedAmount: positiveDecimalStringSchema.nullable(),
  chargedCurrency: z.string().nullable(),
  purchaseAttempts: z.number().int().min(0),
  nextCheckAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  completedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type TopUpFulfillmentDto = z.infer<typeof topUpFulfillmentDtoSchema>;

/** One row of the admin «top-up orders» list, filtered by status. */
export const topUpOrderSummaryDtoSchema = z.object({
  orderId: idSchema,
  orderNumber: z.string().min(1),
  gameName: z.string().min(1),
  offerName: z.string().min(1),
  accountReference: z.string().nullable(),
  status: topUpStatusSchema,
  failureCode: z.string().nullable(),
  /** Set when the customer must be told something through a work item. */
  workItemId: idSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type TopUpOrderSummary = z.infer<typeof topUpOrderSummaryDtoSchema>;

/** The full trace page for one order: fulfillment plus every event, in order. */
export const topUpTraceDtoSchema = z.object({
  fulfillment: topUpFulfillmentDtoSchema,
  events: z.array(topUpEventDtoSchema),
});
export type TopUpTraceDto = z.infer<typeof topUpTraceDtoSchema>;

/**
 * The only statuses an operator filters by in practice, because they are the
 * ones that need a human to look at something.
 */
export const TOP_UP_ATTENTION_STATUS_VALUES = ['UNKNOWN', 'WAITING_FUNDS', 'FAILED'] as const;
