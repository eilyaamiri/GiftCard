import type Decimal from 'decimal.js';

import type {
  FxRateSnapshot as ContractFxRateSnapshot,
  PricingBreakdown as WirePricingBreakdown,
  PricingComponentKind,
} from '@barat/contracts';

/** Inputs to the pure pricing formula. USD cost is exact Decimal, never number. */
export interface PricingInput {
  /**
   * What one unit costs US, in USD — a negotiated number that has nothing to do
   * with what is printed on the card. It sets our cost and our margin; it never
   * sets the price.
   */
  readonly supplierCostUsd: Decimal;
  /**
   * What the customer is buying, in USD, per unit: the face value of a gift
   * card, or the requested amount of a service. THIS is what the price is
   * computed from, so that a $25 card is charged as $25 at the rate the site
   * advertises rather than as whatever we happened to pay for it.
   *
   * Required, with no default, on purpose: a caller that cannot tell the two
   * apart has to say so explicitly by passing the supplier cost twice.
   */
  readonly customerForeignAmount: Decimal;
  readonly quantity: number;
  readonly discountIrr?: bigint;
}

/** Immutable pricing rule values consumed by the engine. */
export interface PricingRule {
  readonly id: string;
  readonly name: string;
  readonly version: number;
  readonly fxSpreadBps: number;
  readonly fxRiskBufferBps: number;
  readonly serviceFeeBps: number;
  readonly serviceFeeFixedIrr: bigint;
  readonly operationalFeeIrr: bigint;
  readonly targetMarginBps: number;
  readonly minimumMarginIrr: bigint;
  readonly paymentFeeBps: number;
  readonly paymentFeeFixedIrr: bigint;
  readonly quoteTtlSeconds: number;
  readonly roundingStepIrr: bigint;
  readonly maxSupplierCostToleranceBps: number;
}

/** The frozen cross-package FX snapshot is embedded verbatim in every result. */
export type FxRateSnapshot = ContractFxRateSnapshot;

export interface PricingComponent {
  readonly kind: PricingComponentKind;
  readonly amountIrr: bigint;
  readonly bps: number | null;
}

/**
 * Internal, auditable pricing result. Every monetary component remains bigint.
 * Use `toWirePricingBreakdown` only at an HTTP/JSON boundary.
 */
export interface PricingBreakdown {
  readonly pricingVersion: number;
  readonly ruleId: string;
  readonly fxSnapshotUsed: FxRateSnapshot;

  readonly marketFxRate: string;
  readonly effectiveFxRate: string;
  readonly fxSpreadAmount: bigint;
  readonly fxRiskBufferAmount: bigint;

  readonly supplierCostUsd: string;
  readonly totalSupplierCostUsd: string;
  readonly quantity: number;
  readonly marketSupplierCostIrr: bigint;
  readonly supplierCostIrr: bigint;

  /**
   * The charge base: what the customer is buying, converted at the rate they are
   * shown. Fees and the target margin are all bps of this, and it is the figure
   * the pre-invoice's «بهای کالا» line is built from.
   */
  readonly customerForeignAmount: string;
  readonly totalCustomerForeignAmount: string;
  readonly customerAmountIrr: bigint;

  readonly paymentFee: bigint;
  readonly serviceFee: bigint;
  readonly operationalFee: bigint;
  /**
   * The two halves of `marginAmount`, kept apart for the admin: what buying
   * below face value earned us (`productMarginAmount`) versus what the rule's
   * `targetMarginBps` added on top (`targetMarginAmount`). Their sum is the
   * margin unless `minimumMarginIrr` had to lift it.
   */
  readonly productMarginAmount: bigint;
  readonly targetMarginAmount: bigint;
  readonly marginAmount: bigint;
  readonly marginFloorApplied: boolean;
  readonly discountAmount: bigint;

  readonly subtotal: bigint;
  readonly roundingAdjustment: bigint;
  readonly finalAmountIrr: bigint;
  readonly displayAmountToman: bigint;

  readonly contributionIrr: bigint;
  readonly effectiveMarginBps: number;
  readonly components: readonly PricingComponent[];
}

export type { WirePricingBreakdown };
