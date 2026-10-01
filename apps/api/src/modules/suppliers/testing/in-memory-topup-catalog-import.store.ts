import type {
  NewTopUpGame,
  NewTopUpOffer,
  TopUpCatalogImportStore,
  TopUpImportSnapshot,
} from '../suppliers.types';

/** A game as the assertions read it back. */
export interface ImportedGameState {
  readonly id: string;
  readonly supplierCode: string;
  readonly providerCategoryId: string;
  readonly slug: string;
  name: string;
  isActive: boolean;
  readonly requiresCredentials: boolean;
  readonly fields: NewTopUpGame['fields'];
  readonly offers: { readonly providerOfferId: string; name: string; isActive: boolean }[];
}

export interface ImportedSupplierState {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  isActive: boolean;
}

/**
 * The import port, in memory.
 *
 * It models `isActive` on every row, including rows seeded as if an operator
 * had already curated them, so "an import never rewrites an existing row" is
 * asserted against state that could actually have been overwritten.
 */
export class InMemoryTopUpCatalogImportStore implements TopUpCatalogImportStore {
  readonly suppliers = new Map<string, ImportedSupplierState>();
  readonly games: ImportedGameState[] = [];
  /** Slugs owned by other suppliers' games (the column is globally unique). */
  readonly foreignSlugs = new Set<string>();
  applyCalls = 0;
  failApply: Error | undefined;
  private nextId = 1;

  seedSupplier(code: string, isActive: boolean): ImportedSupplierState {
    const supplier = { id: `sup-${this.nextId++}`, code, name: code, isActive };
    this.suppliers.set(code, supplier);
    return supplier;
  }

  seedGame(input: {
    readonly supplierCode: string;
    readonly providerCategoryId: string;
    readonly slug: string;
    readonly name: string;
    readonly isActive: boolean;
    readonly offers: readonly { readonly providerOfferId: string; readonly name: string; readonly isActive: boolean }[];
  }): ImportedGameState {
    const game: ImportedGameState = {
      id: `game-${this.nextId++}`,
      supplierCode: input.supplierCode,
      providerCategoryId: input.providerCategoryId,
      slug: input.slug,
      name: input.name,
      isActive: input.isActive,
      requiresCredentials: false,
      fields: [],
      offers: input.offers.map((offer) => ({ ...offer })),
    };
    this.games.push(game);
    return game;
  }

  async snapshot(supplierCode: string): Promise<TopUpImportSnapshot> {
    const supplier = this.suppliers.get(supplierCode);
    return {
      supplier: supplier === undefined ? null : { id: supplier.id, isActive: supplier.isActive },
      games: this.games
        .filter((game) => game.supplierCode === supplierCode)
        .map((game) => ({
          id: game.id,
          providerCategoryId: game.providerCategoryId,
          providerOfferIds: game.offers.map((offer) => offer.providerOfferId),
        })),
      takenSlugs: [...this.games.map((game) => game.slug), ...this.foreignSlugs],
    };
  }

  async applyImport(input: Parameters<TopUpCatalogImportStore['applyImport']>[0]): Promise<void> {
    this.applyCalls += 1;
    if (this.failApply !== undefined) {
      throw this.failApply;
    }
    if (!this.suppliers.has(input.supplier.code)) {
      this.suppliers.set(input.supplier.code, {
        id: `sup-${this.nextId++}`,
        code: input.supplier.code,
        name: input.supplier.name,
        isActive: false,
      });
    }
    const toState = (offer: NewTopUpOffer) => ({
      providerOfferId: offer.providerOfferId,
      name: offer.name,
      isActive: offer.isActive,
    });
    for (const game of input.newGames) {
      this.games.push({
        id: `game-${this.nextId++}`,
        supplierCode: input.supplier.code,
        providerCategoryId: game.providerCategoryId,
        slug: game.slug,
        name: game.name,
        isActive: false,
        requiresCredentials: game.requiresCredentials,
        fields: game.fields,
        offers: game.offers.map(toState),
      });
    }
    for (const group of input.newOffers) {
      const game = this.games.find((row) => row.id === group.gameId);
      if (game === undefined) {
        throw new Error(`unknown game ${group.gameId}`);
      }
      game.offers.push(...group.offers.map(toState));
    }
  }

  game(providerCategoryId: string): ImportedGameState | undefined {
    return this.games.find((game) => game.providerCategoryId === providerCategoryId);
  }
}
