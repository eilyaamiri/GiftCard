import Decimal from 'decimal.js';

/**
 * Supplier cost variance.
 *
 * Money never touches a JS float here (AGENTS.md rule 2): both the quoted and
 * the actual cost arrive as fixed-point decimal STRINGS and are compared with
 * decimal.js. The result is an integer basis-point figure (rule 13).
 */

export const COST_VARIANCE_REASONS = {
  WITHIN_TOLERANCE: 'WITHIN_TOLERANCE',
  ABOVE_TOLERANCE: 'ABOVE_TOLERANCE',
  /** No usable quoted baseline: cannot prove the spend was budgeted. */
  NO_BASELINE: 'NO_BASELINE',
  /** Actual cost is in a different currency than the quote. Not comparable. */
  CURRENCY_MISMATCH: 'CURRENCY_MISMATCH',
} as const;

export type CostVarianceReason = (typeof COST_VARIANCE_REASONS)[keyof typeof COST_VARIANCE_REASONS];

export interface CostVarianceAssessment {
  /** Positive = we paid more than quoted. Null when there is no baseline. */
  readonly varianceBps: number | null;
  readonly toleranceBps: number;
  readonly requiresApproval: boolean;
  readonly reason: CostVarianceReason;
}

export interface AssessCostVarianceInput {
  readonly quotedCost: string | null;
  readonly quotedCurrency: string;
  readonly actualCost: string;
  readonly actualCurrency: string;
  readonly toleranceBps: number;
}

const BPS = new Decimal(10_000);

function parseDecimal(value: string): Decimal | null {
  try {
    const parsed = new Decimal(value);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Compares the actual supplier cost against the quoted one.
 *
 * Two deliberate conservative choices:
 *   - The bps figure rounds towards +∞ (`ROUND_CEIL`), so an overspend of
 *     500.1 bps against a 500 bps ceiling reports 501 and is blocked. Rounding
 *     to nearest would silently let it through.
 *   - When the baseline is missing, zero or in another currency the answer is
 *     "a manager must approve", never "fine". An unverifiable spend is exactly
 *     the case the approval gate exists for.
 */
export function assessCostVariance(input: AssessCostVarianceInput): CostVarianceAssessment {
  const toleranceBps = Number.isFinite(input.toleranceBps) ? Math.max(0, Math.trunc(input.toleranceBps)) : 0;

  const actual = parseDecimal(input.actualCost);
  if (actual === null) {
    return { varianceBps: null, toleranceBps, requiresApproval: true, reason: COST_VARIANCE_REASONS.NO_BASELINE };
  }

  if (input.quotedCost === null) {
    return { varianceBps: null, toleranceBps, requiresApproval: true, reason: COST_VARIANCE_REASONS.NO_BASELINE };
  }

  if (input.quotedCurrency.toUpperCase() !== input.actualCurrency.toUpperCase()) {
    return {
      varianceBps: null,
      toleranceBps,
      requiresApproval: true,
      reason: COST_VARIANCE_REASONS.CURRENCY_MISMATCH,
    };
  }

  const quoted = parseDecimal(input.quotedCost);
  if (quoted === null || quoted.isZero() || quoted.isNegative()) {
    return { varianceBps: null, toleranceBps, requiresApproval: true, reason: COST_VARIANCE_REASONS.NO_BASELINE };
  }

  const varianceBps = actual
    .minus(quoted)
    .dividedBy(quoted)
    .times(BPS)
    .toDecimalPlaces(0, Decimal.ROUND_CEIL)
    .toNumber();

  return {
    varianceBps,
    toleranceBps,
    requiresApproval: varianceBps > toleranceBps,
    reason: varianceBps > toleranceBps ? COST_VARIANCE_REASONS.ABOVE_TOLERANCE : COST_VARIANCE_REASONS.WITHIN_TOLERANCE,
  };
}
