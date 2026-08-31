import type Decimal from 'decimal.js';

import type {
  FxRateSnapshot as ContractFxRateSnapshot,
  PricingBreakdown as WirePricingBreakdown,
  PricingComponentKind,
} from '@barat/contracts';

/** Inputs to the pure pricing formula. USD cost is exact Decimal, never number. */
export interface PricingInput {
  readonly supplierCostUsd: Decimal;
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

  readonly paymentFee: bigint;
  readonly serviceFee: bigint;
  readonly operationalFee: bigint;
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
