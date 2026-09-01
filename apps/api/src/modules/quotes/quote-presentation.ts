import type {
  DecimalString,
  FxRateSnapshot,
  IrrString,
  PricingBreakdown as WirePricingBreakdown,
  PricingComponent,
  PricingRuleSnapshot,
  QuoteSnapshot,
  QuoteStatus,
} from '@barat/contracts';

/* ============================================================================
 * Audience-aware quote presentation
 *
 * A quote row stores the FULL calculation: what we pay the supplier, the FX
 * spread, the risk buffer and our margin. That is required for audit (rule 4)
 * and it is exactly what a customer must never see.
 *
 * So there are two views of the same immutable row:
 *
 *   STAFF     every component, verbatim.
 *   CUSTOMER  supplier cost, FX spread, FX risk buffer and margin are folded
 *             into a single "بهای کالا" line, and the supplier offer id is
 *             dropped. Fees, discount and rounding stay visible because the
 *             customer is entitled to see what they are charged for.
 *
 * The fold is exact, not approximate:
 *
 *   goodsIrr = supplierCostIrr + marginAmount
 *            = (marketCost + fxSpread + fxRiskBuffer) + margin
 *
 * so `goods + paymentFee + serviceFee + operationalFee - discount == subtotal`
 * still holds and the customer's arithmetic adds up.
 *
 * The customer's lines are also stated in whole Toman. Fees and margin are
 * basis points of a rial subtotal, so they land on exact rial — a ۸۷,۱۷۶٫۳
 * تومان line is not a price anyone quotes in Iran, and the storefront's
 * formatter refuses a fraction of a Toman outright rather than truncate it.
 * Each line is therefore rounded to the nearest Toman and the rounding line,
 * which exists for exactly this, carries the residual. See `foldComponents`.
 * ==========================================================================*/

export type QuoteAudience = 'CUSTOMER' | 'STAFF';

/** Component kinds a customer never sees; each is folded into the goods line. */
const FOLDED_INTO_GOODS = new Set<PricingComponent['kind']>([
  'SUPPLIER_COST',
  'FX_SPREAD',
  'FX_RISK_BUFFER',
  'MARGIN',
]);

const GOODS_LABEL = 'Item price';
const GOODS_LABEL_FA = 'بهای کالا';

/**
 * What the customer is told the rate came from. Naming the real upstream (and
 * therefore that we have one, and which) is commercially sensitive, and pairing
 * it with the market rate would publish the spread outright.
 */
const CUSTOMER_FX_PROVIDER = 'barat';
const CUSTOMER_FX_SOURCE = 'INTERNAL';

/**
 * `PricingBreakdown.ruleId` and the ids inside `FxRateSnapshot` are required,
 * non-empty strings in the frozen contract, so a customer response cannot
 * simply blank them out — an empty string fails validation at the edge. They
 * carry this placeholder instead, which is both contract-valid and obviously
 * not a real id if it ever shows up in a log or a bug report.
 */
const REDACTED_ID = 'redacted';

/** The persisted quote columns plus its component rows. */
export interface QuoteRow {
  readonly id: string;
  readonly quoteNumber: string;
  readonly customerId: string | null;
  readonly commerceSessionId: string | null;
  readonly cartId: string | null;
  readonly skuId: string | null;
  readonly serviceId: string | null;
  readonly supplierOfferId: string | null;
  readonly quantity: number;
  readonly currency: string;
  readonly pricingRuleId: string | null;
  readonly pricingVersion: number;
  readonly marketFxRate: { toFixed(dp?: number): string };
  readonly effectiveFxRate: { toFixed(dp?: number): string };
  readonly fxProvider: string;
  readonly fxRateId: string | null;
  readonly fxRateTimestamp: Date;
  readonly fxSpreadAmount: bigint;
  readonly fxRiskBufferAmount: bigint;
  readonly supplierCostUsd: { toFixed(dp?: number): string };
  readonly supplierCostIrr: bigint;
  readonly paymentFee: bigint;
  readonly serviceFee: bigint;
  readonly operationalFee: bigint;
  readonly marginAmount: bigint;
  readonly discountAmount: bigint;
  readonly subtotal: bigint;
  readonly finalAmountIrr: bigint;
  readonly displayAmountToman: bigint;
  readonly status: QuoteStatus;
  readonly expiresAt: Date;
  readonly acceptedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly snapshot: unknown;
  readonly components: readonly QuoteComponentRow[];
}

export interface QuoteComponentRow {
  readonly kind: string;
  readonly label: string;
  readonly labelFa: string;
  readonly amountIrr: bigint;
  readonly amountForeign: { toFixed(dp?: number): string } | null;
  readonly currency: string | null;
  readonly bps: number | null;
  readonly sortOrder: number;
}

/** Prisma `Decimal` -> plain decimal string with trailing zeros trimmed. */
export function decimalString(value: { toFixed(dp?: number): string }): string {
  const fixed = value.toFixed(6);
  return fixed.includes('.') ? fixed.replace(/0+$/u, '').replace(/\.$/u, '') : fixed;
}

/** Seconds left before the quote expires; never negative. */
export function secondsRemaining(expiresAt: Date, now: Date): number {
  return Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / 1_000));
}

/**
 * The foreign amount the CUSTOMER is buying — face value x quantity for a gift
 * card, or the requested amount for an international service.
 *
 * This is deliberately not the supplier's cost: it is public information the
 * customer already knows, and it keeps `supplierCostUsd` in the DTO from ever
 * carrying a negotiated cost to a browser.
 */
export function customerForeignAmount(row: QuoteRow): string {
  const stored = readSnapshot(row.snapshot);
  const amount = stored?.['customerForeignAmount'];
  return typeof amount === 'string' ? amount : decimalString(row.supplierCostUsd);
}

export function ruleFromSnapshot(snapshot: unknown): PricingRuleSnapshot | null {
  const stored = readSnapshot(snapshot);
  const rule = stored?.['rule'];
  return isRecord(rule) ? (rule as unknown as PricingRuleSnapshot) : null;
}

/* ------------------------------------------------------------------ quote */

export function toQuoteSnapshotDto(
  row: QuoteRow,
  audience: QuoteAudience,
  now: Date = new Date(),
): QuoteSnapshot {
  const forStaff = audience === 'STAFF';
  const goodsIrr = row.supplierCostIrr + row.marginAmount;

  return {
    id: row.id,
    quoteNumber: row.quoteNumber,
    customerId: row.customerId,
    commerceSessionId: row.commerceSessionId,
    cartId: row.cartId,
    skuId: row.skuId,
    serviceId: row.serviceId,
    /* Supplier identity is staff-only. A customer response always carries null,
     * so no future field rename can turn this into a leak. */
    supplierOfferId: forStaff ? row.supplierOfferId : null,
    quantity: row.quantity,
    currency: row.currency,
    pricingRuleId: forStaff ? row.pricingRuleId : null,
    pricingVersion: row.pricingVersion,
    rule: forStaff ? ruleFromSnapshot(row.snapshot) : null,

    /* Showing the market rate next to the effective rate would publish the
     * spread policy, so a customer sees only the rate they were charged at. */
    marketFxRate: (forStaff
      ? decimalString(row.marketFxRate)
      : decimalString(row.effectiveFxRate)) as DecimalString,
    effectiveFxRate: decimalString(row.effectiveFxRate) as DecimalString,
    fxProvider: forStaff ? row.fxProvider : CUSTOMER_FX_PROVIDER,
    fxRateId: forStaff ? row.fxRateId : null,
    fxRateTimestamp: row.fxRateTimestamp.toISOString(),
    fxSpreadAmount: (forStaff ? row.fxSpreadAmount.toString() : '0') as IrrString,
    fxRiskBufferAmount: (forStaff ? row.fxRiskBufferAmount.toString() : '0') as IrrString,

    supplierCostUsd: (forStaff
      ? decimalString(row.supplierCostUsd)
      : customerForeignAmount(row)) as DecimalString,
    supplierCostIrr: (forStaff ? row.supplierCostIrr.toString() : goodsIrr.toString()) as IrrString,
    paymentFee: row.paymentFee.toString() as IrrString,
    serviceFee: row.serviceFee.toString() as IrrString,
    operationalFee: row.operationalFee.toString() as IrrString,
    marginAmount: (forStaff ? row.marginAmount.toString() : '0') as IrrString,
    discountAmount: row.discountAmount.toString() as IrrString,

    subtotal: row.subtotal.toString() as IrrString,
    finalAmountIrr: row.finalAmountIrr.toString() as IrrString,
    displayAmountToman: row.displayAmountToman.toString() as IrrString,

    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    remainingSeconds: secondsRemaining(row.expiresAt, now),
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),

    components: forStaff
      ? row.components.map((component, sortOrder) => ({
          kind: component.kind as PricingComponent['kind'],
          label: component.label,
          labelFa: component.labelFa,
          amountIrr: component.amountIrr.toString() as IrrString,
          amountForeign:
            component.amountForeign === null
              ? null
              : (decimalString(component.amountForeign) as DecimalString),
          currency: component.currency,
          bps: component.bps,
          sortOrder,
        }))
      : foldComponents(
          row.components.map((component) => ({
            kind: component.kind as PricingComponent['kind'],
            amountIrr: component.amountIrr,
          })),
          goodsIrr,
          customerForeignAmount(row),
          row.currency,
          row.finalAmountIrr,
        ),
  };
}

/* -------------------------------------------------------------- breakdown */

/**
 * The same fold applied to a freshly computed breakdown, so `POST /api/quotes`
 * and `GET /api/quotes/:id` never disagree about what the customer may see.
 */
export function toAudienceBreakdown(
  breakdown: WirePricingBreakdown,
  audience: QuoteAudience,
  foreignAmount: string,
  foreignCurrency: string,
): WirePricingBreakdown {
  if (audience === 'STAFF') {
    return breakdown;
  }

  const goodsIrr = BigInt(breakdown.supplierCostIrr) + BigInt(breakdown.marginAmount);

  return {
    ...breakdown,
    ruleId: REDACTED_ID,
    marketFxRate: breakdown.effectiveFxRate,
    fxProvider: CUSTOMER_FX_PROVIDER,
    fxSpreadAmount: '0' as IrrString,
    fxRiskBufferAmount: '0' as IrrString,
    supplierCostForeign: foreignAmount as DecimalString,
    supplierCostCurrency: foreignCurrency,
    supplierCostIrr: goodsIrr.toString() as IrrString,
    marginAmount: '0' as IrrString,
    marginFloorApplied: false,
    contributionIrr: '0' as IrrString,
    effectiveMarginBps: 0,
    components: foldComponents(
      breakdown.components.map((component) => ({
        kind: component.kind,
        amountIrr: BigInt(component.amountIrr),
      })),
      goodsIrr,
      foreignAmount,
      foreignCurrency,
      BigInt(breakdown.finalAmountIrr),
    ),
  };
}

/* ----------------------------------------------------------------- fx */

/**
 * The FX snapshot as the customer may see it.
 *
 * `CreateQuoteResponse` carries the snapshot next to the breakdown, so masking
 * only the breakdown would be pointless: the raw object still names the upstream
 * provider and still carries the observed buy/sell/mid rates, and the spread is
 * simply `effective - mid`. Every rate the customer sees is therefore the rate
 * they were actually charged at, and the provenance fields are redacted.
 *
 * The unmasked snapshot remains on the persisted quote row for audit (rule 4).
 */
export function toAudienceFxSnapshot(
  fx: FxRateSnapshot,
  audience: QuoteAudience,
  effectiveFxRate: string,
): FxRateSnapshot {
  if (audience === 'STAFF') {
    return fx;
  }
  const charged = effectiveFxRate as FxRateSnapshot['midRate'];
  return {
    ...fx,
    id: null,
    buyRate: charged,
    sellRate: charged,
    midRate: charged,
    provider: CUSTOMER_FX_PROVIDER,
    source: CUSTOMER_FX_SOURCE,
    /* Whether a human pinned today's rate is internal pricing policy. */
    isManualOverride: false,
    overrideReason: null,
  };
}

/* ---------------------------------------------------------------- folding */

/** IRR is the unit of record; 1 Toman = 10 IRR, and Toman is what is quoted. */
const IRR_PER_TOMAN = 10n;

/** Nearest whole Toman, halves away from zero. Sign-safe for DISCOUNT. */
function toWholeToman(irr: bigint): bigint {
  const negative = irr < 0n;
  const abs = negative ? -irr : irr;
  const remainder = abs % IRR_PER_TOMAN;
  const rounded = remainder * 2n >= IRR_PER_TOMAN ? abs - remainder + IRR_PER_TOMAN : abs - remainder;
  return negative ? -rounded : rounded;
}

/**
 * The customer's breakdown: staff components folded down to the lines a buyer
 * is entitled to, each stated in whole Toman, still summing exactly to
 * `finalAmountIrr`.
 *
 * The original ROUNDING component is dropped rather than rounded. It records the
 * step the *total* was rounded to; once every other line moves to the nearest
 * Toman it no longer reconciles, so it is recomputed as the residual against the
 * payable total. That total is guaranteed to be a whole number of Toman —
 * `pricing.service.ts` refuses a rounding step that is not a multiple of 10 IRR
 * — so the residual is whole Toman too, and the column adds up exactly.
 */
function foldComponents(
  components: ReadonlyArray<{ kind: PricingComponent['kind']; amountIrr: bigint }>,
  goodsIrr: bigint,
  foreignAmount: string,
  foreignCurrency: string,
  finalAmountIrr: bigint,
): PricingComponent[] {
  const folded: PricingComponent[] = [];
  let accounted = 0n;

  const push = (
    kind: PricingComponent['kind'],
    amountIrr: bigint,
    foreign: { amount: string; currency: string } | null,
  ): void => {
    if (amountIrr === 0n) return;
    accounted += amountIrr;
    folded.push({
      kind,
      label: CUSTOMER_LABELS[kind][0],
      labelFa: CUSTOMER_LABELS[kind][1],
      amountIrr: amountIrr.toString() as IrrString,
      amountForeign: (foreign?.amount ?? null) as DecimalString | null,
      currency: foreign?.currency ?? null,
      /* The bps rate is a pricing-policy detail; the amount is not. */
      bps: null,
      sortOrder: folded.length,
    });
  };

  push('SUPPLIER_COST', toWholeToman(goodsIrr), { amount: foreignAmount, currency: foreignCurrency });

  for (const component of components) {
    if (FOLDED_INTO_GOODS.has(component.kind) || component.kind === 'ROUNDING') {
      continue;
    }
    push(component.kind, toWholeToman(component.amountIrr), null);
  }

  push('ROUNDING', finalAmountIrr - accounted, null);

  return folded;
}

const CUSTOMER_LABELS: Readonly<Record<PricingComponent['kind'], readonly [string, string]>> = {
  SUPPLIER_COST: [GOODS_LABEL, GOODS_LABEL_FA],
  FX_SPREAD: [GOODS_LABEL, GOODS_LABEL_FA],
  FX_RISK_BUFFER: [GOODS_LABEL, GOODS_LABEL_FA],
  PAYMENT_FEE: ['Payment fee', 'کارمزد پرداخت'],
  SERVICE_FEE: ['Service fee', 'کارمزد خدمات'],
  OPERATIONAL_FEE: ['Operational fee', 'هزینه عملیاتی'],
  MARGIN: [GOODS_LABEL, GOODS_LABEL_FA],
  DISCOUNT: ['Discount', 'تخفیف'],
  ROUNDING: ['Rounding', 'تعدیل گرد کردن'],
};

/* ----------------------------------------------------------------- utils */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readSnapshot(snapshot: unknown): Record<string, unknown> | null {
  return isRecord(snapshot) ? snapshot : null;
}
