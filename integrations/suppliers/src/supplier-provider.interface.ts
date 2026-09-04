import type { DeliveryAssetType } from '@barat/contracts';

/** Nest injection token used by the API's multi-provider registry. */
export const SUPPLIER_PROVIDERS = Symbol.for('barat.supplier-providers');

export type SupplierAvailability = 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
export type SupplierPurchaseStatus = 'SUCCEEDED' | 'PENDING' | 'FAILED' | 'UNKNOWN';

/**
 * Monetary values crossing the integration boundary are decimal strings.
 * A provider adapter must never coerce them through a JavaScript number.
 */
export interface SupplierMoney {
  readonly amount: string;
  readonly currency: string;
}

export interface SupplierCatalogItem {
  readonly providerSku: string;
  readonly name: string;
  readonly brand?: string;
  readonly region: string;
  readonly faceValue: SupplierMoney;
  readonly assetType: DeliveryAssetType;
}

export interface SupplierPrice {
  readonly providerSku: string;
  readonly cost: SupplierMoney;
  readonly observedAt: Date;
}

export interface SupplierAvailabilityResult {
  readonly providerSku: string;
  readonly availability: SupplierAvailability;
  readonly observedAt: Date;
}

/**
 * What a prepaid supplier account currently holds.
 *
 * `amount` is a decimal string in `currency`, exactly like every other money
 * value crossing this boundary — never a JS number, and never converted into
 * another currency by an adapter.
 */
export interface SupplierBalance {
  readonly amount: string;
  readonly currency: string;
  readonly observedAt: Date;
}

export interface SupplierPurchaseRequest {
  readonly providerSku: string;
  readonly quantity: number;
  /** Stable across all attempts. Providers must use it as their idempotency key. */
  readonly idempotencyKey: string;
  readonly recipientEmail?: string;
}

export type SupplierDeliveryAsset =
  | {
      readonly assetType: 'CODE';
      readonly code: string;
      readonly serialNumber?: string;
      readonly expiryDate?: Date;
    }
  | {
      readonly assetType: 'CODE_PIN';
      readonly code: string;
      readonly pin: string;
      readonly serialNumber?: string;
      readonly expiryDate?: Date;
    }
  | {
      readonly assetType: 'URL';
      readonly deliveryUrl: string;
      readonly expiryDate?: Date;
    }
  | {
      readonly assetType: 'PROVIDER_DIRECT_EMAIL';
      readonly recipientEmail: string;
    };

export interface SupplierPurchaseResult {
  readonly status: SupplierPurchaseStatus;
  /** A provider-safe reference, never a code, PIN, token, or raw response. */
  readonly providerReference?: string;
  readonly cost?: SupplierMoney;
  readonly asset?: SupplierDeliveryAsset;
  /** Normalised adapter-owned code, never a raw provider error message. */
  readonly failureCode?: string;
}

/**
 * The only supplier dependency available to domain code. Provider-specific SDKs
 * and payloads stay behind adapters implementing this interface.
 */
export interface SupplierProvider {
  /** Stable logical key matching Supplier.code, e.g. `mock` or `tillo`. */
  readonly key: string;

  getCatalog(): Promise<readonly SupplierCatalogItem[]>;
  getPrice(providerSku: string): Promise<SupplierPrice>;
  checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult>;
  purchase(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResult>;
  getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult>;

  /**
   * The account balance, for adapters that spend from a prepaid float.
   *
   * Optional because it is not universal: a supplier we are invoiced by has no
   * balance to read, and forcing every adapter to fake one would make "we have
   * the funds" indistinguishable from "we never checked". An adapter that omits
   * it is treated as "not applicable", never as "funded".
   */
  getBalance?(): Promise<SupplierBalance>;
}
