import type { SupplierAvailability, SupplierDeliveryAsset } from '@barat/suppliers';

/* ============================================================================
 * Injection tokens
 * ==========================================================================*/

export const SUPPLIER_STORE = Symbol.for('barat.supplier-store');
/** `supplierCode:skuId` -> provider SKU. See the gap note in `suppliers.env.ts`. */
export const PROVIDER_SKU_MAP = Symbol.for('barat.supplier-provider-sku-map');

/* ============================================================================
 * Read models
 *
 * The data model is multi-supplier even though the POC ships one adapter. That
 * is not speculative generality: `Supplier.supportsRawCode` already differs per
 * provider (only Tillo hands over a code), so a single-supplier model would have
 * to be torn out the moment the second provider is added.
 * ==========================================================================*/

export interface SupplierView {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly integrationMode: 'MANUAL' | 'API';
  readonly supportsRawCode: boolean;
  readonly defaultCurrency: string;
  readonly isActive: boolean;
  /** True when an adapter implementing `SupplierProvider` is registered. */
  readonly hasProvider: boolean;
}

export interface SupplierOfferView {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly supportsRawCode: boolean;
  readonly skuId: string;
  /** The identifier passed to the adapter. See the gap note in the service. */
  readonly providerSku: string;
  readonly costCurrency: string;
  /** Decimal string. Never a JS number. */
  readonly costAmount: string;
  readonly discountBps: number;
  readonly availability: string;
  readonly priority: number;
  readonly isActive: boolean;
  readonly lastCheckedAt: Date | null;
}

/* ============================================================================
 * Purchase outcomes
 * ==========================================================================*/

export interface SupplierPurchaseOutcomeBase {
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly offerId: string;
  readonly providerReference: string | null;
}

export type SupplierPurchaseOutcome =
  | (SupplierPurchaseOutcomeBase & {
      readonly status: 'SUCCEEDED';
      readonly cost: { readonly amount: string; readonly currency: string } | null;
      /** Stored encrypted by fulfillment before this result is returned. */
      readonly assetId: string;
      readonly assetType: SupplierDeliveryAsset['assetType'];
      readonly maskedCode: string | null;
    })
  | (SupplierPurchaseOutcomeBase & {
      readonly status: 'PENDING';
      /** The follow-up work item raised for an operator. */
      readonly workItemId: string;
    })
  | (SupplierPurchaseOutcomeBase & {
      readonly status: 'FAILED';
      readonly failureCode: string;
    })
  | (SupplierPurchaseOutcomeBase & {
      readonly status: 'UNKNOWN';
      /** The UNKNOWN_OUTCOME work item. A human decides what happened. */
      readonly workItemId: string;
      readonly failureCode: string | null;
    });

export interface SupplierPurchaseStatusView {
  readonly status: 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNKNOWN';
  readonly providerReference: string | null;
  readonly cost: { readonly amount: string; readonly currency: string } | null;
  readonly assetType: SupplierDeliveryAsset['assetType'] | null;
  readonly failureCode: string | null;
}

/* ============================================================================
 * Persistence port
 * ==========================================================================*/

export interface SupplierStore {
  listSuppliers(): Promise<readonly Omit<SupplierView, 'hasProvider'>[]>;
  findSupplierByCode(code: string): Promise<Omit<SupplierView, 'hasProvider'> | null>;
  /** Active offers for a SKU, cheapest first, then by priority. */
  findOffersForSku(skuId: string): Promise<readonly SupplierOfferView[]>;
  findOfferById(offerId: string): Promise<SupplierOfferView | null>;
  recordAvailabilityCheck(input: {
    offerId: string;
    availability: SupplierAvailability;
    checkedAt: Date;
  }): Promise<void>;
}
