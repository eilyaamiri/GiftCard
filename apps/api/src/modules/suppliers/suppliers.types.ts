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
 * Funding pre-flight
 *
 * Asking "can we afford this?" before `POST /orders` is what turns an empty
 * prepaid float from a half-placed order into a work item an operator picks up.
 * ==========================================================================*/

export type SupplierFundingState =
  /** The account holds at least what this purchase needs. */
  | 'SUFFICIENT'
  /** The account is empty or short. Never attempt a purchase. */
  | 'INSUFFICIENT'
  /** The venue could not be asked. Also never attempt a purchase. */
  | 'UNKNOWN'
  /** This supplier has no prepaid float — an invoiced or manual supplier. */
  | 'NOT_APPLICABLE';

export interface SupplierFundingView {
  readonly state: SupplierFundingState;
  readonly supplierCode: string;
  /** Null when the balance could not be read, or does not exist. */
  readonly balance: { readonly amount: string; readonly currency: string } | null;
  /** What this purchase needs, in the offer's cost currency. Decimal string. */
  readonly required: { readonly amount: string; readonly currency: string };
  /** Set when the balance is in a currency we cannot compare against the cost. */
  readonly currencyMismatch: boolean;
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
 * Automation target
 *
 * Everything the auto-fulfillment orchestrator must re-read from the database
 * before it is willing to spend money. Nothing here comes from a caller: the
 * work item id is the only input, and the order, the SKU and the quantity are
 * all derived from it.
 * ==========================================================================*/

export interface AutoFulfillmentTarget {
  readonly workItemId: string;
  readonly workItemType: string;
  readonly workItemStatus: string;
  readonly assignedToStaffId: string | null;
  readonly orderId: string;
  readonly customerId: string | null;
  readonly orderStatus: string;
  /** Null for a service order, which is a payment abroad rather than a card. */
  readonly skuId: string | null;
  readonly quantity: number;
  /** Non-zero means this order already has a delivery asset. */
  readonly assetCount: number;
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
  /** What a work item would have to buy, or `null` when it cannot be resolved. */
  findAutoFulfillmentTarget(workItemId: string): Promise<AutoFulfillmentTarget | null>;
  recordAvailabilityCheck(input: {
    offerId: string;
    availability: SupplierAvailability;
    checkedAt: Date;
  }): Promise<void>;
}
