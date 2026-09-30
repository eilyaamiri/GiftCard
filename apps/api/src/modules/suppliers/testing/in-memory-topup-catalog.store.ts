import type { TopUpCatalogStore, TopUpSyncableSupplier } from '../suppliers.types';

/** One game, as the assertions read it after a sync. */
export interface CatalogGameState {
  readonly id: string;
  readonly supplierId: string;
  listed: boolean;
}

/** One offer, and the two switches that must never be confused with each other. */
export interface CatalogOfferState {
  readonly id: string;
  readonly supplierId: string;
  listed: boolean;
  /** The operator's curation switch. A sync must never write this. */
  active: boolean;
}

export interface InMemoryTopUpCatalogOptions {
  readonly suppliers?: readonly TopUpSyncableSupplier[];
  /** Offers seeded as active — an operator having already put them on sale. */
  readonly activeOfferIds?: readonly string[];
  /** Games seeded as listed, for asserting a delist is a real transition. */
  readonly listedGameIds?: readonly string[];
  readonly listedOfferIds?: readonly string[];
  /** Thrown by `listSyncableSuppliers`, to prove a read failure writes nothing. */
  readonly failList?: Error;
  /** Thrown by `applyAvailability`, to prove a mid-run failure is not swallowed. */
  readonly failApply?: Error;
  /** Mirrors the port's staging switch: listed rows are kept hidden instead. */
  readonly listingEnabled?: boolean;
}

/**
 * The catalogue-shape port, in memory.
 *
 * Deliberately not a free-form fake. The whole point of this port is that a sync
 * touches `isListed` and never `isActive` and never a cost, so the double keeps
 * `active` as its own field that no `applyAvailability` call can reach — a test
 * asserting "the operator's switch survived" would otherwise be asserting that a
 * field the double does not model stayed untouched, which proves nothing.
 *
 * It also records every applied plan, so a test can assert what the sync asked
 * for rather than only what the plan function computed.
 */
export class InMemoryTopUpCatalogStore implements TopUpCatalogStore {
  private readonly suppliers: readonly TopUpSyncableSupplier[];
  private readonly games = new Map<string, CatalogGameState>();
  private readonly offers = new Map<string, CatalogOfferState>();

  /** Every `applyAvailability` call, in order. */
  readonly applied: {
    supplierId: string;
    listedGameIds: readonly string[];
    delistedGameIds: readonly string[];
    listedOfferIds: readonly string[];
    delistedOfferIds: readonly string[];
    syncedAt: Date;
    listingEnabled: boolean | undefined;
  }[] = [];

  constructor(private readonly options: InMemoryTopUpCatalogOptions = {}) {
    this.suppliers = options.suppliers ?? [];
    const activeOffers = new Set(options.activeOfferIds ?? []);
    const listedGames = options.listedGameIds === undefined ? null : new Set(options.listedGameIds);
    const listedOffers = options.listedOfferIds === undefined ? null : new Set(options.listedOfferIds);

    for (const supplier of this.suppliers) {
      for (const game of supplier.games) {
        this.games.set(game.id, {
          id: game.id,
          supplierId: supplier.id,
          listed: listedGames?.has(game.id) ?? true,
        });
      }
      for (const offer of supplier.offers) {
        this.offers.set(offer.id, {
          id: offer.id,
          supplierId: supplier.id,
          listed: listedOffers?.has(offer.id) ?? true,
          active: activeOffers.has(offer.id),
        });
      }
    }
  }

  /** Availability after the sync. `undefined` when the id is unknown to the double. */
  isGameListed(gameId: string): boolean | undefined {
    return this.games.get(gameId)?.listed;
  }

  isOfferListed(offerId: string): boolean | undefined {
    return this.offers.get(offerId)?.listed;
  }

  /** The operator's switch, which no sync may touch. */
  isOfferActive(offerId: string): boolean | undefined {
    return this.offers.get(offerId)?.active;
  }

  async listSyncableSuppliers(): Promise<readonly TopUpSyncableSupplier[]> {
    if (this.options.failList !== undefined) throw this.options.failList;
    return this.suppliers;
  }

  async applyAvailability(input: {
    readonly supplierId: string;
    readonly listedGameIds: readonly string[];
    readonly delistedGameIds: readonly string[];
    readonly listedOfferIds: readonly string[];
    readonly delistedOfferIds: readonly string[];
    readonly syncedAt: Date;
    readonly listingEnabled?: boolean;
  }): Promise<void> {
    if (this.options.failApply !== undefined) throw this.options.failApply;

    this.applied.push({
      supplierId: input.supplierId,
      listedGameIds: input.listedGameIds,
      delistedGameIds: input.delistedGameIds,
      listedOfferIds: input.listedOfferIds,
      delistedOfferIds: input.delistedOfferIds,
      syncedAt: input.syncedAt,
      listingEnabled: input.listingEnabled,
    });

    /* Delist before list, matching `PrismaTopUpCatalogStore`. Nothing depends on
     * the order here, but a double whose ordering differs from production is a
     * double that can hide a real ordering bug the day one appears. */
    for (const id of input.delistedGameIds) {
      const game = this.games.get(id);
      if (game !== undefined) game.listed = false;
    }
    for (const id of input.delistedOfferIds) {
      const offer = this.offers.get(id);
      if (offer !== undefined) offer.listed = false;
    }
    for (const id of input.listedGameIds) {
      const game = this.games.get(id);
      if (game !== undefined) game.listed = this.options.listingEnabled === true ? false : true;
    }
    for (const id of input.listedOfferIds) {
      const offer = this.offers.get(id);
      if (offer !== undefined) offer.listed = this.options.listingEnabled === true ? false : true;
    }
    /* `active` is untouched on every path above, and there is no branch here
     * that could touch it — see the class comment. */
  }
}
