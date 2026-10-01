import type {
  SupplierAvailability,
  SupplierDeliveryAsset,
  SupplierPrice,
  SupplierTopUpGame,
} from '@barat/suppliers';

/* ============================================================================
 * Injection tokens
 * ==========================================================================*/

export const SUPPLIER_STORE = Symbol.for('barat.supplier-store');
/** Persistence for the automated top-up path. Separate from `SUPPLIER_STORE`. */
export const TOP_UP_STORE = Symbol.for('barat.topup-store');
/** Catalogue *shape* for top-ups. Separate from `TOP_UP_STORE`: see below. */
export const TOP_UP_CATALOG_STORE = Symbol.for('barat.topup-catalog-store');
/** `supplierCode:skuId` -> provider SKU. See the gap note in `suppliers.env.ts`. */
export const PROVIDER_SKU_MAP = Symbol.for('barat.supplier-provider-sku-map');
/** Provider-neutral live price lookup used by quote creation. */
export const SUPPLIER_PRICE_LOOKUP = Symbol.for('barat.supplier-price-lookup');

export interface SupplierPriceLookup {
  getLivePrice(input: {
    readonly supplierCode: string;
    readonly providerSku: string;
  }): Promise<SupplierPrice | null>;
}

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

/* ============================================================================
 * Direct top-up
 *
 * Everything the automated top-up path re-reads from the database before it is
 * willing to spend money. As with `AutoFulfillmentTarget`, nothing here comes
 * from a caller: the order id is the only input, and the game, the offer, the
 * supplier and the account fields are all derived from the order's own
 * immutable quote.
 * ==========================================================================*/

export const TOP_UP_PURCHASE_RECOVERY_GRACE_MS = 5 * 60 * 1_000;

/** A live provider POST owns its durable claim until this grace period elapses. */
export function isStalePurchasingClaim(startedAt: Date | null, now: Date): boolean {
  return (
    startedAt !== null &&
    startedAt.getTime() <= now.getTime() - TOP_UP_PURCHASE_RECOVERY_GRACE_MS
  );
}

export type TopUpFulfillmentStatus =
  | 'QUEUED'
  | 'WAITING_FUNDS'
  | 'PURCHASING'
  | 'AWAITING_PROVIDER'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'UNKNOWN';

/** What the supplier needs to know, all of it copied from the quote snapshot. */
export interface TopUpTarget {
  readonly orderId: string;
  readonly customerId: string;
  readonly orderStatus: string;
  readonly fulfillmentId: string;
  readonly status: TopUpFulfillmentStatus;
  /** `${providerCategoryId}:${providerOfferId}`, frozen when the order was paid. */
  readonly providerSku: string;
  readonly costAmount: string;
  readonly costCurrency: string;
  readonly supplierCode: string;
  readonly supplierId: string;
  /**
   * Exactly what to send as `account_fields`. A public game identifier such as
   * `player_id`, never a credential: games requiring a login are refused at
   * quote time, so no password can reach here.
   */
  readonly accountFields: Readonly<Record<string, string>>;
  /** Non-null once the supplier has assigned an order number, for polling. */
  readonly providerOrderNumber: string | null;
  readonly purchaseAttempts: number;
}

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

/** One step of a top-up's append-only trace. */
export interface TopUpEventRecord {
  readonly type:
    | 'QUEUED'
    | 'ELIGIBILITY_CHECKED'
    | 'BALANCE_CHECKED'
    | 'PURCHASE_REQUESTED'
    | 'PURCHASE_RESPONDED'
    | 'STATUS_POLLED'
    | 'SUCCEEDED'
    | 'FAILED'
    | 'MARKED_UNKNOWN'
    | 'REFUND_OPENED'
    | 'CUSTOMER_NOTIFIED'
    | 'OPERATOR_NOTE'
    | 'OPERATOR_ACTION';
  /** Non-secret, structured context. Never an API key or a raw supplier body. */
  readonly detail?: Record<string, unknown> | null;
  readonly providerStatus?: string | null;
  readonly failureCode?: string | null;
}

/**
 * Persistence for the automated top-up path.
 *
 * Expressed as intentions rather than queries, like `WorkItemStore`: the
 * service asserts on the booleans, it does not re-read and re-decide. The
 * append-only event methods take no "update" form on purpose — a trace that can
 * be rewritten is not a trace.
 */
export type DueTopUpAction = 'START' | 'POLL';

export interface DueTopUp {
  readonly orderId: string;
  readonly action: DueTopUpAction;
}

export interface TopUpStore {
  /**
   * Idempotently creates the fulfillment trace for a paid top-up order from its
   * immutable quote snapshot. Returns null when the order is not a paid top-up.
   */
  ensureFulfillmentForPaidOrder(orderId: string): Promise<TopUpTarget | null>;
  /** Resolves everything needed to buy, from the order alone. */
  findTargetByOrderId(orderId: string): Promise<TopUpTarget | null>;
  /** Paid rows missing a trace, plus waiting rows whose retry deadline passed. */
  listDue(): Promise<readonly DueTopUp[]>;
  /** Consecutive unreachable polls derived from the append-only event trace. */
  countConsecutiveUnreachablePolls(fulfillmentId: string): Promise<number>;
  /** Moves the fulfillment and records the step, in one transaction. */
  transition(input: {
    fulfillmentId: string;
    from: readonly TopUpFulfillmentStatus[];
    to: TopUpFulfillmentStatus;
    event: TopUpEventRecord;
    /** Venue order number, once the supplier has assigned one. */
    providerOrderNumber?: string | null;
    providerStatus?: string | null;
    failureCode?: string | null;
    chargedAmount?: string | null;
    chargedCurrency?: string | null;
    nextCheckAt?: Date | null;
    /** Only set on the transition that starts a purchase attempt. */
    incrementPurchaseAttempts?: boolean;
    /** `completedAt` is set once, on a terminal status. */
    completedAt?: Date | null;
  }): Promise<boolean>;
  /** Appends one event without changing status. Still never an update. */
  recordEvent(input: {
    fulfillmentId: string;
    orderId: string;
    status: TopUpFulfillmentStatus;
    event: TopUpEventRecord;
  }): Promise<void>;
  /** Moves the order itself, through the state machine's own guarded path. */
  transitionOrder(input: {
    orderId: string;
    from: readonly string[];
    to: string;
    failureReason?: string | null;
  }): Promise<boolean>;
}

/* ============================================================================
 * Top-up catalogue shape
 * ==========================================================================*/

/** A game and the venue offer ids that belong to it. */
export interface TopUpCatalogGame {
  readonly id: string;
  readonly providerCategoryId: string;
  readonly providerOfferIds: readonly string[];
}

export interface TopUpCatalogOffer {
  readonly id: string;
  /** The venue's own id, which is what a sync matches on. Never a price. */
  readonly providerOfferId: string;
  /**
   * The owning game's category. Carried on the offer because the venue's SKU
   * is composed from both, and an offer id alone is not unique across games.
   */
  readonly providerCategoryId: string;
}

export interface TopUpSyncableSupplier {
  readonly id: string;
  readonly code: string;
  readonly games: readonly TopUpCatalogGame[];
  readonly offers: readonly TopUpCatalogOffer[];
}

/**
 * Catalogue *shape*, which is a different question from `TopUpStore`.
 *
 * `TopUpStore` reads the trace of one order and never writes a catalogue row;
 * widening it to carry a sync would hand every fulfillment caller a write path
 * to the storefront. This port exists for the sync alone, so an in-memory fake
 * can assert what a sync did without a database.
 *
 * There is deliberately no `costAmount` anywhere in this port. Availability is
 * the only thing a sync owns — see `topup-catalog.sync.ts` for why.
 */
export interface TopUpCatalogStore {
  /** Suppliers that are enabled and have games to reconcile. */
  listSyncableSuppliers(): Promise<readonly TopUpSyncableSupplier[]>;
  /**
   * Applies one supplier's availability in a single transaction.
   *
   * `isActive` is not a parameter and must not be written: it is the operator's
   * curation switch, and a sync that set it would put an unreviewed product on
   * sale the moment a venue added it.
   */
  applyAvailability(input: {
    readonly supplierId: string;
    readonly listedGameIds: readonly string[];
    readonly delistedGameIds: readonly string[];
    readonly listedOfferIds: readonly string[];
    readonly delistedOfferIds: readonly string[];
    readonly syncedAt: Date;
    /**
     * When true, games and offers the venue still lists are kept hidden —
     * `isListed` is written false instead of true. Used to stage a catalogue
     * without advertising it. Defaults to false.
     */
    readonly listingEnabled?: boolean;
  }): Promise<void>;
}

/* ============================================================================
 * Top-up catalogue import
 * ==========================================================================*/

/** The venues a catalogue import can read. Separate from `SUPPLIER_PROVIDERS`: see below. */
export const TOP_UP_CATALOG_READERS = Symbol.for('barat.topup-catalog-readers');
/** Persistence for the import. Separate from `TOP_UP_CATALOG_STORE`, which only ever writes availability. */
export const TOP_UP_CATALOG_IMPORT_STORE = Symbol.for('barat.topup-catalog-import-store');

/**
 * One venue's top-up catalogue, and nothing else.
 *
 * Not a `SupplierProvider`: registering an adapter is what lets fulfillment
 * spend, and that is gated by a human-set flag. Importing games has to happen
 * *before* that decision — they are reviewed and activated first — so the
 * import gets a reader that can list a catalogue and has no purchase method to
 * call, rather than a provider that happens not to be asked to buy.
 */
export interface TopUpCatalogReader {
  /** The `Supplier.code` the imported games belong to. */
  readonly supplierCode: string;
  /** Used only if the supplier row does not exist yet. */
  readonly supplierName: string;
  readonly defaultCurrency: string;
  readCatalog(): Promise<readonly SupplierTopUpGame[]>;
}

/** What already exists, so an import creates only what is missing. */
export interface TopUpImportSnapshot {
  readonly supplier: { readonly id: string; readonly isActive: boolean } | null;
  /** This supplier's games, keyed by the venue's category id. */
  readonly games: readonly {
    readonly id: string;
    readonly providerCategoryId: string;
    readonly providerOfferIds: readonly string[];
  }[];
  /** Every `TopUpGame.slug` in use, across all suppliers: the column is globally unique. */
  readonly takenSlugs: readonly string[];
}

export interface NewTopUpField {
  readonly key: string;
  readonly label: string;
  readonly labelFa: string | null;
  readonly fieldType: 'TEXT' | 'SELECT';
  readonly isRequired: boolean;
  readonly options: readonly { readonly label: string; readonly value: string }[] | null;
  readonly validationRegex: string | null;
  readonly sortOrder: number;
}

/**
 * An offer to create. There is no cost here on purpose: the quote reads the
 * venue's price live, and the store writes the column's placeholder zero —
 * the same thing the seed does — rather than a stale number that looks real.
 */
export interface NewTopUpOffer {
  readonly providerOfferId: string;
  readonly name: string;
  readonly sortOrder: number;
  readonly isActive: boolean;
}

export interface NewTopUpGame {
  readonly providerCategoryId: string;
  readonly slug: string;
  readonly name: string;
  readonly region: string;
  readonly imageUrl: string | null;
  readonly providerNote: string | null;
  readonly requiresCredentials: boolean;
  readonly sortOrder: number;
  readonly fields: readonly NewTopUpField[];
  readonly offers: readonly NewTopUpOffer[];
}

/**
 * The import's persistence. Create-only by construction: there is no method
 * that updates an existing game, field or offer, and nothing that writes
 * `isActive` on a row that already exists.
 */
export interface TopUpCatalogImportStore {
  snapshot(supplierCode: string): Promise<TopUpImportSnapshot>;
  /**
   * Creates the supplier if it is missing (always inactive), the new games
   * with their fields and offers, and new offers on existing games — in one
   * transaction.
   */
  applyImport(input: {
    readonly supplier: { readonly code: string; readonly name: string; readonly defaultCurrency: string };
    readonly newGames: readonly NewTopUpGame[];
    readonly newOffers: readonly { readonly gameId: string; readonly offers: readonly NewTopUpOffer[] }[];
    readonly importedAt: Date;
  }): Promise<void>;
}

/**
 * Two writers created the same game or slug at once. The import is refused
 * as a whole — its transaction rolled back — and running it again is safe.
 */
export class TopUpImportRaceError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('a concurrent write created the same top-up game or slug', options);
    this.name = 'TopUpImportRaceError';
  }
}
