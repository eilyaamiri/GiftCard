import { Inject, Injectable, Logger } from '@nestjs/common';
import type { SupplierMoney, SupplierTopUpField, SupplierTopUpGame } from '@barat/suppliers';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AuditService } from '../audit/audit.service';
import {
  TOP_UP_CATALOG_IMPORT_STORE,
  TOP_UP_CATALOG_READERS,
  TopUpImportRaceError,
  type NewTopUpField,
  type NewTopUpGame,
  type NewTopUpOffer,
  type TopUpCatalogImportStore,
  type TopUpCatalogReader,
  type TopUpImportSnapshot,
} from './suppliers.types';

/**
 * ============================================================================
 * Top-up catalogue import — creates games, never sells them
 * ============================================================================
 *
 * The sync (`topup-catalog.sync.ts`) keeps existing rows honest about what the
 * venue still lists. It cannot create anything, and a venue like FazerCards
 * lists hundreds of games whose account fields differ per game — user id only,
 * or user id plus a server. This is the step that brings them in.
 *
 * WHAT IT GUARANTEES
 *
 *   - Create-only. A game, field or offer that already exists is never
 *     rewritten: an operator may have renamed it, translated it or taken it
 *     off sale, and a re-import must not undo that.
 *   - Nothing it creates is sellable. New games are inactive, and the supplier
 *     — when the import has to create it — is inactive too. Selling needs an
 *     operator's review AND the human-set `FAZERCARDS_TOPUP_ENABLED`.
 *   - A game that wants a password, a login code or an OTP is imported with
 *     `requiresCredentials`, which the quote path refuses outright. It is kept
 *     rather than dropped so the operator can see what was left out and why.
 *   - No price is stored: quotes read the venue live.
 *   - No work item, no order, no purchase. The reader it is handed has no
 *     purchase method to call.
 *
 * A dry run computes exactly the same plan and writes nothing, so the admin
 * can check what the venue's answer parsed into before committing it.
 */

export const TOP_UP_IMPORT_AUDIT_ACTION = 'TOP_UP_CATALOG_IMPORTED';

export type TopUpImportSkipReason =
  /** The venue lists the game with nothing on sale. */
  | 'NO_OFFERS'
  /** No account field at all: there is nowhere to send the top-up. */
  | 'NO_ACCOUNT_FIELDS'
  /** Telegram is sold under its own supplier and storefront page. */
  | 'SERVED_BY_TELEGRAM_SUPPLIER';

export interface TopUpImportGameReport {
  readonly providerCategoryId: string;
  readonly name: string;
  /** The slug it was, or would be, created under. Null for skipped and existing games. */
  readonly slug: string | null;
  readonly status: 'NEW' | 'EXISTING' | 'SKIPPED';
  readonly skipReason?: TopUpImportSkipReason;
  readonly requiresCredentials: boolean;
  readonly fields: readonly {
    readonly key: string;
    readonly label: string;
    readonly type: 'TEXT' | 'SELECT';
    readonly required: boolean;
    readonly credential: boolean;
  }[];
  /** Offers created (or to be created). For an existing game, only the ones it did not have. */
  readonly newOffers: number;
  readonly offers: readonly {
    readonly offerId: string;
    readonly name: string;
    /** The venue's price at read time, for the operator's eyes only. Never stored. */
    readonly cost: SupplierMoney | null;
  }[];
}

export interface TopUpImportResult {
  readonly dryRun: boolean;
  readonly supplierCode: string;
  /** True when the supplier row did not exist (and, unless dry, was created inactive). */
  readonly supplierCreated: boolean;
  readonly games: readonly TopUpImportGameReport[];
  readonly totals: {
    readonly newGames: number;
    readonly newOffers: number;
    /** New games flagged `requiresCredentials` — imported, never sold. */
    readonly credentialGames: number;
    readonly skipped: number;
  };
}

interface ImportPlan {
  readonly result: Omit<TopUpImportResult, 'dryRun'>;
  readonly newGames: readonly NewTopUpGame[];
  readonly newOffers: readonly { readonly gameId: string; readonly offers: readonly NewTopUpOffer[] }[];
}

const MAX_SLUG_LENGTH = 90;
const TELEGRAM_PATTERN = /telegram/i;

/**
 * `PUBG Mobile (Global)` → `pubg-mobile-global`. Matches the catalogue slug
 * rule (`^[a-z0-9]+(?:-[a-z0-9]+)*$`); a name with no latin letters at all
 * falls back to the venue's category id.
 */
export function slugifyGameName(name: string, providerCategoryId: string): string {
  const base = (value: string): string =>
    value
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG_LENGTH)
      .replace(/-+$/g, '');
  const fromName = base(name);
  if (fromName !== '') {
    return fromName;
  }
  const fromCategory = base(providerCategoryId);
  return fromCategory === '' ? 'game' : `game-${fromCategory}`.slice(0, MAX_SLUG_LENGTH);
}

/** The first of `slug`, `slug-2`, `slug-3`, … not in `taken`. Adds it to `taken`. */
export function uniqueSlug(slug: string, taken: Set<string>): string {
  let candidate = slug;
  for (let n = 2; taken.has(candidate); n += 1) {
    const suffix = `-${n}`;
    candidate = `${slug.slice(0, MAX_SLUG_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`;
  }
  taken.add(candidate);
  return candidate;
}

/**
 * A Persian label for the two fields nearly every game asks for, so the
 * storefront form reads naturally without an operator translating hundreds of
 * identical rows. Anything else keeps the venue's English label.
 */
export function persianFieldLabel(field: SupplierTopUpField): string | null {
  const text = `${field.key} ${field.label}`.toLowerCase();
  if (/\b(server|zone)\b|server_?id|zone_?id/.test(text)) {
    return field.type === 'SELECT' ? 'سرور' : 'شناسه سرور';
  }
  if (/\b(player|user|uid|role|game|account)[ _-]?id\b|\buid\b/.test(text)) {
    return 'شناسه بازیکن';
  }
  return null;
}

function toNewField(field: SupplierTopUpField, sortOrder: number): NewTopUpField {
  return {
    key: field.key,
    label: field.label,
    labelFa: persianFieldLabel(field),
    fieldType: field.type,
    isRequired: field.required,
    options: field.type === 'SELECT' && field.options !== undefined ? field.options : null,
    validationRegex: field.pattern ?? null,
    sortOrder,
  };
}

function skipReasonOf(game: SupplierTopUpGame): TopUpImportSkipReason | null {
  if (TELEGRAM_PATTERN.test(game.name) || TELEGRAM_PATTERN.test(game.categoryId)) {
    return 'SERVED_BY_TELEGRAM_SUPPLIER';
  }
  if (game.offers.length === 0) {
    return 'NO_OFFERS';
  }
  if (game.fields.length === 0) {
    return 'NO_ACCOUNT_FIELDS';
  }
  return null;
}

/**
 * Decides what an import would create, from the venue's answer and what
 * already exists. Pure, so the rules above are tested without a database.
 */
export function planTopUpImport(input: {
  readonly supplierCode: string;
  readonly catalog: readonly SupplierTopUpGame[];
  readonly snapshot: TopUpImportSnapshot;
}): ImportPlan {
  const existing = new Map(input.snapshot.games.map((game) => [game.providerCategoryId, game]));
  const taken = new Set(input.snapshot.takenSlugs);
  const seenCategories = new Set<string>();
  const reports: TopUpImportGameReport[] = [];
  const newGames: NewTopUpGame[] = [];
  const newOffers: { gameId: string; offers: NewTopUpOffer[] }[] = [];
  let nextSortOrder = input.snapshot.games.length;

  for (const game of input.catalog) {
    /* A venue that repeats a category must not produce two games for it. */
    if (seenCategories.has(game.categoryId)) {
      continue;
    }
    seenCategories.add(game.categoryId);

    const report = {
      providerCategoryId: game.categoryId,
      name: game.name,
      requiresCredentials: game.requiresCredentials,
      fields: game.fields.map((field) => ({
        key: field.key,
        label: field.label,
        type: field.type,
        required: field.required,
        credential: field.credential,
      })),
      offers: game.offers.map((offer) => ({ offerId: offer.offerId, name: offer.name, cost: offer.cost })),
    };

    const skipReason = skipReasonOf(game);
    if (skipReason !== null) {
      reports.push({ ...report, slug: null, status: 'SKIPPED', skipReason, newOffers: 0 });
      continue;
    }

    const known = existing.get(game.categoryId);
    if (known !== undefined) {
      const had = new Set(known.providerOfferIds);
      const added = game.offers
        .filter((offer) => !had.has(offer.offerId))
        .map((offer, index) => ({
          providerOfferId: offer.offerId,
          name: offer.name,
          sortOrder: known.providerOfferIds.length + index,
          /* The game may already be on sale; the operator has not seen this offer. */
          isActive: false,
        }));
      if (added.length > 0) {
        newOffers.push({ gameId: known.id, offers: added });
      }
      reports.push({ ...report, slug: null, status: 'EXISTING', newOffers: added.length });
      continue;
    }

    const slug = uniqueSlug(slugifyGameName(game.name, game.categoryId), taken);
    const offers = game.offers.map((offer, index) => ({
      providerOfferId: offer.offerId,
      name: offer.name,
      sortOrder: index,
      /* The game itself is created inactive; its review is the gate. */
      isActive: true,
    }));
    newGames.push({
      providerCategoryId: game.categoryId,
      slug,
      name: game.name,
      region: game.region,
      imageUrl: game.imageUrl,
      providerNote: game.note,
      requiresCredentials: game.requiresCredentials,
      sortOrder: nextSortOrder,
      fields: game.fields.map((field, index) => toNewField(field, index)),
      offers,
    });
    nextSortOrder += 1;
    reports.push({ ...report, slug, status: 'NEW', newOffers: offers.length });
  }

  return {
    result: {
      supplierCode: input.supplierCode,
      supplierCreated: input.snapshot.supplier === null,
      games: reports,
      totals: {
        newGames: newGames.length,
        newOffers:
          newGames.reduce((sum, game) => sum + game.offers.length, 0) +
          newOffers.reduce((sum, group) => sum + group.offers.length, 0),
        credentialGames: newGames.filter((game) => game.requiresCredentials).length,
        skipped: reports.filter((report) => report.status === 'SKIPPED').length,
      },
    },
    newGames,
    newOffers,
  };
}

@Injectable()
export class TopUpCatalogImportService {
  private readonly logger = new Logger(TopUpCatalogImportService.name);
  private readonly readers: ReadonlyMap<string, TopUpCatalogReader>;
  private running = false;

  constructor(
    @Inject(TOP_UP_CATALOG_IMPORT_STORE) private readonly store: TopUpCatalogImportStore,
    @Inject(TOP_UP_CATALOG_READERS) readers: readonly TopUpCatalogReader[],
    @Inject(AuditService) private readonly audit: AuditService,
  ) {
    this.readers = new Map(readers.map((reader) => [reader.supplierCode, reader]));
  }

  /** The supplier codes an import can read, for the admin screen. */
  get supplierCodes(): readonly string[] {
    return [...this.readers.keys()];
  }

  /**
   * Imports one venue's top-up catalogue.
   *
   * Overlapping runs are refused: two imports would both see a game as new and
   * the second would fail on the unique key halfway through a large catalogue.
   */
  async import(input: {
    readonly supplierCode: string;
    readonly dryRun: boolean;
    readonly actor: { readonly id: string; readonly role: string };
  }): Promise<TopUpImportResult> {
    const reader = this.readers.get(input.supplierCode);
    if (reader === undefined) {
      throw DomainErrors.featureDisabled(`top-up catalogue import for ${input.supplierCode}`);
    }
    if (this.running) {
      throw DomainErrors.conflict('یک ورود کاتالوگ در حال اجراست؛ چند لحظه بعد دوباره تلاش کنید.');
    }
    this.running = true;
    try {
      return await this.run(reader, input);
    } finally {
      this.running = false;
    }
  }

  private async run(
    reader: TopUpCatalogReader,
    input: { readonly dryRun: boolean; readonly actor: { readonly id: string; readonly role: string } },
  ): Promise<TopUpImportResult> {
    /* The whole catalogue is read before anything is planned or written. */
    let catalog: readonly SupplierTopUpGame[];
    try {
      catalog = await reader.readCatalog();
    } catch (error) {
      /* The error's class only: adapter messages are safe, but this stays terse by rule. */
      const detail = error instanceof Error ? error.name : 'unknown error';
      throw DomainErrors.conflict(
        'دریافت کاتالوگ از تأمین‌کننده ناموفق بود. چند دقیقه بعد دوباره تلاش کنید.',
        `top-up catalogue read failed for ${reader.supplierCode}: ${detail}`,
      );
    }

    const snapshot = await this.store.snapshot(reader.supplierCode);
    const plan = planTopUpImport({ supplierCode: reader.supplierCode, catalog, snapshot });
    const result: TopUpImportResult = { dryRun: input.dryRun, ...plan.result };
    if (input.dryRun) {
      return result;
    }

    try {
      await this.store.applyImport({
        supplier: {
          code: reader.supplierCode,
          name: reader.supplierName,
          defaultCurrency: reader.defaultCurrency,
        },
        newGames: plan.newGames,
        newOffers: plan.newOffers,
        importedAt: new Date(),
      });
    } catch (error) {
      if (error instanceof TopUpImportRaceError) {
        throw DomainErrors.conflict(
          'کاتالوگ هم‌زمان تغییر کرد و چیزی ذخیره نشد. دوباره تلاش کنید.',
          error.message,
        );
      }
      throw error;
    }

    await this.audit.record({
      actor: input.actor.id,
      actorType: 'STAFF',
      actorRole: input.actor.role,
      action: TOP_UP_IMPORT_AUDIT_ACTION,
      entity: 'Supplier',
      entityId: reader.supplierCode,
      after: {
        supplierCreated: result.supplierCreated,
        ...result.totals,
        newGameSlugs: plan.newGames.map((game) => game.slug),
      },
    });
    this.logger.log(
      `top-up catalogue imported for ${reader.supplierCode}: ${result.totals.newGames} games, ${result.totals.newOffers} offers`,
    );
    return result;
  }
}
