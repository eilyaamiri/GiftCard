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
  /** Public account identifiers required for a direct top-up, never credentials. */
  readonly requiredAccountFields?: readonly string[];
  /**
   * A label this venue uses to group its own offers, e.g. `PUBG Mobile`.
   *
   * Optional: a flat catalogue leaves it out and every item stands alone. It
   * exists for venues like FazerCards that list a game's offers as one long
   * `kind`-tagged stream, where a sync must be able to tell which rows belong
   * to the same game and which of them is a purchasable offer.
   */
  readonly groupLabel?: string;
  /**
   * What this row IS, when a venue mixes kinds in one catalogue.
   *
   * `OFFER` (or absent) means something with a price to sell — the default for
   * every existing adapter. `GAME` means the row describes a game that is not
   * itself purchasable; a sync must create the game and no offer from it.
   * Without this a sync would either invent an offer for a game row or drop the
   * game entirely, and both are wrong in ways nobody would notice until a
   * customer could not buy the thing.
   */
  readonly itemKind?: 'GAME' | 'OFFER';
}

/**
 * One input a direct top-up venue asks the customer for, as the venue declares
 * it. `key` is sent back verbatim in `accountFields` at purchase time.
 */
export interface SupplierTopUpField {
  readonly key: string;
  readonly label: string;
  readonly type: 'TEXT' | 'SELECT';
  readonly required: boolean;
  /** Only for `SELECT`: the values the venue accepts. */
  readonly options?: readonly { readonly label: string; readonly value: string }[];
  /** The venue's own validation pattern, copied as-is. */
  readonly pattern?: string;
  /**
   * The venue wants a secret here — a password, a login code, an OTP. We never
   * collect those, so a game with any such field is never sold.
   */
  readonly credential: boolean;
}

export interface SupplierTopUpOffer {
  readonly offerId: string;
  readonly name: string;
  /** The venue's current price, or null when it could not be read. Informational: quotes re-read it live. */
  readonly cost: SupplierMoney | null;
}

/**
 * A game as a direct top-up venue lists it: what the customer must type, and
 * the packages on sale. `requiresCredentials` is true when any field is a
 * credential, and such a game must never reach a storefront.
 */
export interface SupplierTopUpGame {
  readonly categoryId: string;
  readonly name: string;
  readonly region: string;
  readonly note: string | null;
  readonly imageUrl: string | null;
  readonly fields: readonly SupplierTopUpField[];
  readonly offers: readonly SupplierTopUpOffer[];
  readonly requiresCredentials: boolean;
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
  /**
   * The game account a direct top-up is credited to, keyed by the venue's own
   * field names (`player_id`, `server`, ...).
   *
   * Absent for a gift card. These are public identifiers — the ones the customer
   * typed on the product page — and never a credential: a game that wants an
   * email and password is refused at quote time, so a password cannot reach an
   * adapter through this field.
   */
  readonly accountFields?: Readonly<Record<string, string>>;
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
    }
  | {
      /**
       * A direct top-up: the venue credited the player's own game account and
       * there is nothing to hand over. Carries no secret by construction, which
       * is the point — an adapter cannot accidentally return a code here.
       *
       * `accountReference` is what the venue confirms it credited, e.g.
       * `player_id=5001234567`. It is public and displayable; the account the
       * customer typed is already theirs.
       */
      readonly assetType: 'DIRECT_TOPUP';
      readonly accountReference: string;
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

  /**
   * The venue's direct top-up catalogue, grouped by game with each game's
   * account fields. Read-only.
   *
   * Optional: only a venue that sells game top-ups has one. It exists so a
   * catalogue import can create games and their field definitions, which the
   * flat `getCatalog` cannot express.
   */
  getTopUpCatalog?(): Promise<readonly SupplierTopUpGame[]>;
}
