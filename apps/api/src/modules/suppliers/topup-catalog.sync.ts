import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPPLIER_PROVIDERS, type SupplierCatalogItem, type SupplierProvider } from '@barat/suppliers';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import { TOP_UP_CATALOG_STORE } from './suppliers.types';
import { describeCatalogReadFailure } from './topup-catalog.import';
import type { TopUpCatalogStore, TopUpCatalogGame, TopUpCatalogOffer } from './suppliers.types';
import { topUpProviderSku } from './topup-provider-sku';

/**
 * ============================================================================
 * Top-up catalog sync — availability only, never a price
 * ============================================================================
 *
 * WHAT THIS IS FOR
 *
 * A venue stops offering a package. Nobody tells us. The storefront keeps
 * showing it, the customer picks it, and the failure lands at quote time — or
 * worse, after payment. This sync is the thing that notices.
 *
 * WHAT IT IS *NOT* FOR
 *
 * It does NOT price anything. The customer's price is computed at quote time
 * from a live read of the venue's rate, and `QuotesService` already refuses to
 * fall back to a stored cost (see `liveTopUpPrice`). Writing a cost here would
 * be writing a number into the database that looks authoritative and is stale
 * the moment the venue's rate moves — which it does, hourly. So `costAmount` is
 * deliberately absent from every type in this file.
 *
 * The two switches are different things and this service only touches one:
 *
 *   - `isListed`  — does the venue still offer it?      ← THIS SERVICE OWNS IT
 *   - `isActive`  — has an operator put it on sale?     ← THE OPERATOR'S, NEVER TOUCHED
 *
 * `isActive` is the product owner's curation switch. A sync that flipped it on
 * would put an unreviewed product in front of a customer the moment a venue
 * added it, which is exactly what the seeded-inactive design exists to prevent.
 * `applyAvailability` is therefore written to leave it alone even when the row
 * is being marked listed again.
 *
 * FAILURE POLICY: ALL OR NOTHING
 *
 * The catalogue is fetched in full before a single row is written. A venue that
 * answers halfway, or a network that drops mid-read, would otherwise leave us
 * with half a catalogue and mass-delist everything we did not get to — turning
 * a transient outage into a storefront that looks empty. If a supplier's read
 * fails, none of that supplier's rows are touched: it is reported in `failed`
 * and the other suppliers are still synced. When every read fails the caller
 * gets a conflict carrying the adapter's safe failure code — never a bare 500,
 * which would tell the operator nothing.
 */

/** The audit actor for a sync run. There is no customer and no order. */
export const TOP_UP_SYNC_ACTOR = 'system:topup-catalog-sync';

export const TOP_UP_SYNC_AUDIT_ACTION = 'TOP_UP_CATALOG_SYNCED';

export interface TopUpSyncResult {
  /** Supplier codes that were read, in the order they were synced. */
  readonly suppliers: readonly string[];
  readonly gamesListed: number;
  readonly gamesDelisted: number;
  readonly offersListed: number;
  readonly offersDelisted: number;
  /** Provider SKUs the venue returned that we have no local offer for. */
  readonly unknownSkus: readonly string[];
  /**
   * Suppliers whose catalogue could not be read. Their rows were left exactly
   * as they were; `code` is the adapter's normalised failure code, if safe.
   */
  readonly failed: readonly { readonly supplierCode: string; readonly code: string | null }[];
}

interface AvailabilityPlan {
  readonly listedGames: readonly string[];
  readonly delistedGames: readonly string[];
  readonly listedOffers: readonly string[];
  readonly delistedOffers: readonly string[];
  readonly unknownSkus: readonly string[];
}

/**
 * Decides what the venue's answer means for our rows.
 *
 * Split out from the service and made pure because this is where a mistake is
 * silent: an inverted comparison here does not throw, it just quietly delists a
 * product nobody can then buy, or keeps selling one that is gone.
 *
 * The listing rule is identity by provider SKU — the venue's own key, never a
 * price, because two live offers routinely share a price. The SKU is composed
 * by `topUpProviderSku`, the same function that hands a quote the SKU to price,
 * so what the venue returns is compared against exactly what we would buy. The
 * venue answers in full SKUs (`stars:50`, or `telegram:stars:50` for the
 * namespaced Telegram catalogue); matching them against a bare offer id would
 * recognise nothing and delist every row.
 */
export function planAvailability(input: {
  readonly supplierCode: string;
  readonly catalog: readonly SupplierCatalogItem[];
  readonly games: readonly TopUpCatalogGame[];
  readonly offers: readonly TopUpCatalogOffer[];
}): AvailabilityPlan {
  const seen = new Set(input.catalog.map((item) => item.providerSku));
  const skuOf = (providerCategoryId: string, providerOfferId: string): string =>
    topUpProviderSku(input.supplierCode, providerCategoryId, providerOfferId);
  const offerSeen = (offer: TopUpCatalogOffer): boolean =>
    seen.has(skuOf(offer.providerCategoryId, offer.providerOfferId));

  const knownSkus = new Set(
    input.offers.map((offer) => skuOf(offer.providerCategoryId, offer.providerOfferId)),
  );
  const unknownSkus = [...seen].filter((sku) => !knownSkus.has(sku));

  const listedGames = input.games
    .filter((game) => game.providerOfferIds.some((id) => seen.has(skuOf(game.providerCategoryId, id))))
    .map((game) => game.id);

  /*
   * A game with no offers in the venue's answer is delisted, and that is the
   * point: the storefront shows games, not offers, and a game whose every
   * package is gone is a dead end the customer would still be led into.
   */
  const listedGameIds = new Set(listedGames);
  const delistedGames = input.games
    .filter((game) => !listedGameIds.has(game.id))
    .map((game) => game.id);

  return {
    listedGames,
    delistedGames,
    listedOffers: input.offers.filter(offerSeen).map((o) => o.id),
    delistedOffers: input.offers.filter((offer) => !offerSeen(offer)).map((o) => o.id),
    unknownSkus,
  };
}

@Injectable()
export class TopUpCatalogSyncService {
  private readonly logger = new Logger(TopUpCatalogSyncService.name);
  private readonly providersByKey: ReadonlyMap<string, SupplierProvider>;
  private running = false;

  constructor(
    @Inject(TOP_UP_CATALOG_STORE) private readonly store: TopUpCatalogStore,
    @Inject(SUPPLIER_PROVIDERS) providers: readonly SupplierProvider[],
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.providersByKey = new Map(providers.map((provider) => [provider.key, provider]));
  }

  /**
   * Reads every syncable supplier and applies what the venue says.
   *
   * Overlapping runs are refused rather than queued: two syncs racing would
   * each compute a plan from the same "before" state and the second write would
   * undo the first's delisting. The guard is process-local, which is honest —
   * this is triggered by an operator, not by a fleet.
   */
  async sync(): Promise<TopUpSyncResult> {
    if (this.running) {
      throw DomainErrors.conflict('یک همگام‌سازی در حال اجراست؛ چند لحظه بعد دوباره تلاش کنید.');
    }
    this.running = true;
    try {
      return await this.run();
    } finally {
      this.running = false;
    }
  }

  private async run(): Promise<TopUpSyncResult> {
    const suppliers = await this.store.listSyncableSuppliers();
    const totals = {
      suppliers: [] as string[],
      gamesListed: 0,
      gamesDelisted: 0,
      offersListed: 0,
      offersDelisted: 0,
      unknownSkus: [] as string[],
      failed: [] as { supplierCode: string; code: string | null }[],
    };

    for (const supplier of suppliers) {
      const provider = this.providersByKey.get(supplier.code);
      if (provider === undefined) {
        /*
         * An active supplier with no adapter cannot be synced — and must not be
         * treated as "the venue lists nothing", which would delist its whole
         * catalogue because a flag is off. Skip and say so.
         */
        this.logger.warn(
          `supplier ${supplier.code} is enabled but has no adapter; skipping its top-up sync`,
        );
        continue;
      }

      let catalog: readonly SupplierCatalogItem[];
      try {
        catalog = await provider.getCatalog();
      } catch (error) {
        /* An unreadable venue is not an empty one: nothing of this supplier's is written. */
        const failure = describeCatalogReadFailure(error);
        this.logger.warn(`top-up sync ${supplier.code}: catalogue read failed (${failure.detail}); left unchanged`);
        totals.failed.push({ supplierCode: supplier.code, code: failure.code });
        continue;
      }
      const plan = planAvailability({
        supplierCode: supplier.code,
        catalog,
        games: supplier.games,
        offers: supplier.offers,
      });

      await this.store.applyAvailability({
        supplierId: supplier.id,
        listedGameIds: plan.listedGames,
        delistedGameIds: plan.delistedGames,
        listedOfferIds: plan.listedOffers,
        delistedOfferIds: plan.delistedOffers,
        syncedAt: new Date(),
      });

      totals.suppliers.push(supplier.code);
      totals.gamesListed += plan.listedGames.length;
      totals.gamesDelisted += plan.delistedGames.length;
      totals.offersListed += plan.listedOffers.length;
      totals.offersDelisted += plan.delistedOffers.length;
      totals.unknownSkus.push(...plan.unknownSkus);

      this.logger.log(
        `top-up sync ${supplier.code}: ${String(plan.listedOffers.length)} listed, ` +
          `${String(plan.delistedOffers.length)} delisted`,
      );
    }

    if (totals.suppliers.length === 0 && totals.failed.length > 0) {
      /* Nothing was synced and nothing written: say why instead of reporting an empty success. */
      const codes = [...new Set(totals.failed.map((f) => f.code).filter((code) => code !== null))];
      throw DomainErrors.conflict(
        codes.length === 0
          ? 'دریافت کاتالوگ از تأمین‌کننده ناموفق بود. چند دقیقه بعد دوباره تلاش کنید.'
          : `دریافت کاتالوگ از تأمین‌کننده ناموفق بود (کد خطا: ${codes.join('، ')}). چند دقیقه بعد دوباره تلاش کنید.`,
        `top-up sync read failed for ${totals.failed.map((f) => f.supplierCode).join(', ')}`,
      );
    }

    await this.audit.record({
      actor: TOP_UP_SYNC_ACTOR,
      actorType: 'SYSTEM',
      action: TOP_UP_SYNC_AUDIT_ACTION,
      entity: 'TopUpCatalog',
      entityId: totals.suppliers.join(',') || 'none',
      after: {
        suppliers: totals.suppliers,
        gamesListed: totals.gamesListed,
        gamesDelisted: totals.gamesDelisted,
        offersListed: totals.offersListed,
        offersDelisted: totals.offersDelisted,
        /* Recorded because it is the thing an operator most needs to see: a SKU
         * the venue sells and we do not. It usually means a ladder entry was
         * added upstream, and it is invisible from the storefront. */
        unknownSkus: totals.unknownSkus,
        failed: totals.failed,
      },
    });

    return totals;
  }
}
