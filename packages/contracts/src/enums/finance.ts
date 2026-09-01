import { z } from 'zod';

import { enumFrom } from '../internal/enum-utils';

/* ============================================================================
 * FX
 * ==========================================================================*/

/** The POC trades exactly one pair. Adding a pair is a pricing decision. */
export const FX_PAIR_VALUES = ['USD_IRR'] as const;

export const FxPair = enumFrom(FX_PAIR_VALUES);
export type FxPair = (typeof FX_PAIR_VALUES)[number];
export const fxPairSchema = z.enum(FX_PAIR_VALUES);

/**
 * The supplier cost currencies the quote engine can actually price.
 *
 * Derived from the traded pairs on purpose: a SKU whose only supplier offer is
 * in a currency with no FX pair cannot be quoted, and the catalog must not
 * present it as buyable — otherwise the storefront sends the customer into a
 * "not priceable right now" error after they press buy. Adding a pair to
 * `FX_PAIR_VALUES` therefore makes its products sellable in the same commit,
 * with no second list to keep in sync.
 */
export const QUOTABLE_COST_CURRENCIES: readonly string[] = FX_PAIR_VALUES.map(
  (pair) => pair.split('_')[0] as string,
);

/* ============================================================================
 * Reconciliation
 * ==========================================================================*/

/**
 * The 14 mismatch classes the reconciliation engine detects. Values are
 * snake_case because they are also used as report row keys and metric labels.
 */
export const RECONCILIATION_ISSUE_TYPE_VALUES = [
  'payment_without_order',
  'paid_not_fulfilled',
  'supplier_purchase_without_fulfillment',
  'amount_mismatch',
  'duplicate_payment',
  'unknown_payment',
  'unknown_supplier_outcome',
  'refund_mismatch',
  'paid_without_work_item',
  'fulfilled_without_gift_card',
  'gift_card_entered_not_sent',
  'sent_not_fulfilled',
  'delivery_failed',
  'missing_actual_supplier_cost',
] as const;

export const ReconciliationIssueType = enumFrom(RECONCILIATION_ISSUE_TYPE_VALUES);
export type ReconciliationIssueType = (typeof RECONCILIATION_ISSUE_TYPE_VALUES)[number];
export const reconciliationIssueTypeSchema = z.enum(RECONCILIATION_ISSUE_TYPE_VALUES);

/**
 * `IGNORED_WITH_REASON` never means "deleted" — the row stays, with the reason
 * and the staff member who made the call. Financial history is never removed.
 */
export const RECONCILIATION_STATUS_VALUES = [
  'OPEN',
  'INVESTIGATING',
  'RESOLVED',
  'IGNORED_WITH_REASON',
] as const;

export const ReconciliationStatus = enumFrom(RECONCILIATION_STATUS_VALUES);
export type ReconciliationStatus = (typeof RECONCILIATION_STATUS_VALUES)[number];
export const reconciliationStatusSchema = z.enum(RECONCILIATION_STATUS_VALUES);
