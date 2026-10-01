import { describe, expect, it } from 'vitest';
// From the barrel, never `@barat/suppliers/providers/*`: the import-boundary
// rule in eslint.config.mjs forbids domain code (tests included) from naming a
// concrete adapter path.
import { MockSupplierProvider, type SupplierProvider } from '@barat/suppliers';

import { BaratDomainException } from '../../common/errors/domain.exception';

import { AuditService, type AuditWriter } from '../audit/audit.service';
import { InMemoryTopUpCatalogStore } from './testing/in-memory-topup-catalog.store';
import { TopUpCatalogSyncService, planAvailability } from './topup-catalog.sync';
import type { TopUpCatalogGame, TopUpCatalogOffer, TopUpSyncableSupplier } from './suppliers.types';
import type { SupplierCatalogItem } from '@barat/suppliers';

/**
 * ============================================================================
 * THE SYNC'S CONTRACT, ASSERTED: availability and nothing else
 * ============================================================================
 *
 * Three claims, in order of how expensive they are to get wrong:
 *
 *   1. A SKU the venue stopped offering gets delisted — including a whole game
 *      whose every package is gone, because the storefront sells games and a
 *      game with no offers is a dead end a customer is still led into.
 *   2. The operator's `isActive` switch is NEVER written, so a game or offer the
 *      venue has just added arrives hidden and stays hidden until a human puts
 *      it on sale. A sync that flipped it would put an unreviewed product in
 *      front of a customer, which is the exact failure the seeded-inactive
 *      design exists to prevent.
 *   3. A read that fails writes NOTHING. The all-or-nothing rule is what stands
 *      between a venue's five-minute outage and a storefront that looks empty
 *      because every product was mass-delisted by a half-completed read.
 *
 * No cost is asserted anywhere, and none can be: there is no cost on any type
 * in this feature. That absence is the design, not an omission.
 */

const SUPPLIER_ID = 'sup-telegram';
const SUPPLIER_CODE = 'mock';
const GAME_STARS = 'game-stars';
const GAME_PREMIUM = 'game-premium';
const OFFER_STARS_50 = 'offer-stars-50';
const OFFER_STARS_100 = 'offer-stars-100';
const OFFER_PREMIUM_3M = 'offer-premium-3m';

/**
 * One item in the venue's answer, keyed by its full provider SKU.
 *
 * The remaining fields are the minimum `SupplierCatalogItem` demands and are
 * never read by the sync — it deliberately has no opinion on a name, a price or
 * an asset type, because none of those is availability.
 */
const item = (providerSku: string): SupplierCatalogItem => ({
  providerSku,
  name: providerSku,
  region: 'GLOBAL',
  faceValue: { amount: '1', currency: 'USD' },
  assetType: 'DIRECT_TOPUP',
});

/**
 * What an un-namespaced venue calls our offer: `{category}:{offer}`, the shape
 * `topUpProviderSku` composes for every supplier but the Telegram one. The venue
 * never answers with a bare offer id, so no fixture here does either.
 */
const CATEGORY_BY_OFFER: Readonly<Record<string, string>> = {
  [OFFER_STARS_50]: 'stars',
  [OFFER_STARS_100]: 'stars',
  [OFFER_PREMIUM_3M]: 'premium',
};
const sku = (offerId: string): SupplierCatalogItem =>
  item(`${CATEGORY_BY_OFFER[offerId] ?? 'stars'}:${offerId}`);

function games(): readonly TopUpCatalogGame[] {
  return [
    { id: GAME_STARS, providerCategoryId: 'stars', providerOfferIds: [OFFER_STARS_50, OFFER_STARS_100] },
    { id: GAME_PREMIUM, providerCategoryId: 'premium', providerOfferIds: [OFFER_PREMIUM_3M] },
  ];
}

function offers(): readonly TopUpCatalogOffer[] {
  return [
    { id: OFFER_STARS_50, providerOfferId: OFFER_STARS_50, providerCategoryId: 'stars' },
    { id: OFFER_STARS_100, providerOfferId: OFFER_STARS_100, providerCategoryId: 'stars' },
    { id: OFFER_PREMIUM_3M, providerOfferId: OFFER_PREMIUM_3M, providerCategoryId: 'premium' },
  ];
}

function supplier(): TopUpSyncableSupplier {
  return { id: SUPPLIER_ID, code: SUPPLIER_CODE, games: games(), offers: offers() };
}

interface Harness {
  readonly service: TopUpCatalogSyncService;
  readonly store: InMemoryTopUpCatalogStore;
  readonly provider: MockSupplierProvider;
  readonly audits: readonly Record<string, unknown>[];
}

function harness(
  options: {
    readonly catalog?: readonly SupplierCatalogItem[];
    readonly suppliers?: readonly TopUpSyncableSupplier[];
    readonly providers?: readonly MockSupplierProvider[];
    readonly activeOfferIds?: readonly string[];
    readonly failList?: Error;
    readonly failApply?: Error;
  } = {},
): Harness {
  const audits: Record<string, unknown>[] = [];
  const writer: AuditWriter = {
    append: async (entry) => {
      audits.push(entry as unknown as Record<string, unknown>);
    },
  };
  const audit = new AuditService(writer);
  const store = new InMemoryTopUpCatalogStore({
    suppliers: options.suppliers ?? [supplier()],
    ...(options.activeOfferIds === undefined ? {} : { activeOfferIds: options.activeOfferIds }),
    ...(options.failList === undefined ? {} : { failList: options.failList }),
    ...(options.failApply === undefined ? {} : { failApply: options.failApply }),
  });
  const provider = new MockSupplierProvider({ catalog: options.catalog ?? [] });
  return {
    service: new TopUpCatalogSyncService(store, options.providers ?? [provider], audit),
    store,
    provider,
    audits,
  };
}

describe('planAvailability', () => {
  it('lists what the venue returned and delists what it did not', () => {
    const plan = planAvailability({
      supplierCode: SUPPLIER_CODE,
      catalog: [sku(OFFER_STARS_50), sku(OFFER_PREMIUM_3M)],
      games: games(),
      offers: offers(),
    });

    expect(plan.listedOffers).toEqual([OFFER_STARS_50, OFFER_PREMIUM_3M]);
    expect(plan.delistedOffers).toEqual([OFFER_STARS_100]);
    /* Both games still have at least one package, so neither is delisted. */
    expect(plan.listedGames).toEqual([GAME_STARS, GAME_PREMIUM]);
    expect(plan.delistedGames).toEqual([]);
  });

  it('delists a game whose every offer is gone, not just the offers', () => {
    const plan = planAvailability({
      supplierCode: SUPPLIER_CODE,
      catalog: [sku(OFFER_STARS_50), sku(OFFER_STARS_100)],
      games: games(),
      offers: offers(),
    });

    expect(plan.listedGames).toEqual([GAME_STARS]);
    expect(plan.delistedGames).toEqual([GAME_PREMIUM]);
    expect(plan.delistedOffers).toEqual([OFFER_PREMIUM_3M]);
  });

  it('reports a venue SKU we hold no offer for instead of silently ignoring it', () => {
    const plan = planAvailability({
      supplierCode: SUPPLIER_CODE,
      catalog: [sku(OFFER_STARS_50), sku('offer-stars-1000-upstream')],
      games: games(),
      offers: offers(),
    });

    expect(plan.unknownSkus).toEqual(['stars:offer-stars-1000-upstream']);
    expect(plan.listedOffers).toEqual([OFFER_STARS_50]);
  });

  it('matches on the venue SKU, never on a price — two offers may share one', () => {
    /* Both live offers are the same identity as far as this function is
     * concerned; only the arena they came from decides. A price-keyed match
     * would put these two in a map and lose one of them. */
    const plan = planAvailability({
      supplierCode: SUPPLIER_CODE,
      catalog: [sku(OFFER_STARS_50)],
      games: [{ id: GAME_STARS, providerCategoryId: 'stars', providerOfferIds: [OFFER_STARS_50] }],
      offers: [
        { id: OFFER_STARS_50, providerOfferId: OFFER_STARS_50, providerCategoryId: 'stars' },
        { id: OFFER_STARS_100, providerOfferId: OFFER_STARS_100, providerCategoryId: 'stars' },
      ],
    });

    expect(plan.listedOffers).toEqual([OFFER_STARS_50]);
    expect(plan.delistedOffers).toEqual([OFFER_STARS_100]);
  });
});

describe('planAvailability — the namespaced Telegram catalogue', () => {
  /*
   * The production shape. FazerCards' Telegram adapter answers in
   * `telegram:{stars|premium}:{offer}`, while our rows hold the bare venue
   * offer id (`50`, `3`). A sync that compared the two directly recognised
   * nothing: every offer and both games were delisted, and every SKU the venue
   * sells was reported as unknown. These cases pin the composition to the one
   * `topUpProviderSku` uses when it asks the same venue for a price.
   */
  const TELEGRAM = 'fazercards-telegram';
  const telegramGames = (): readonly TopUpCatalogGame[] => [
    { id: GAME_STARS, providerCategoryId: 'stars', providerOfferIds: ['50', '100'] },
    { id: GAME_PREMIUM, providerCategoryId: 'premium', providerOfferIds: ['3'] },
  ];
  const telegramOffers = (): readonly TopUpCatalogOffer[] => [
    { id: 'tg-stars-50', providerOfferId: '50', providerCategoryId: 'stars' },
    { id: 'tg-stars-100', providerOfferId: '100', providerCategoryId: 'stars' },
    { id: 'tg-premium-3', providerOfferId: '3', providerCategoryId: 'premium' },
  ];

  it('recognises every offer the venue still sells instead of mass-delisting', () => {
    const plan = planAvailability({
      supplierCode: TELEGRAM,
      catalog: [item('telegram:stars:50'), item('telegram:stars:100'), item('telegram:premium:3')],
      games: telegramGames(),
      offers: telegramOffers(),
    });

    expect(plan.listedOffers).toEqual(['tg-stars-50', 'tg-stars-100', 'tg-premium-3']);
    expect(plan.delistedOffers).toEqual([]);
    expect(plan.listedGames).toEqual([GAME_STARS, GAME_PREMIUM]);
    expect(plan.delistedGames).toEqual([]);
    expect(plan.unknownSkus).toEqual([]);
  });

  it('still delists the one package the venue withdrew, and reports a new one', () => {
    const plan = planAvailability({
      supplierCode: TELEGRAM,
      catalog: [item('telegram:stars:50'), item('telegram:premium:3'), item('telegram:stars:5000')],
      games: telegramGames(),
      offers: telegramOffers(),
    });

    expect(plan.delistedOffers).toEqual(['tg-stars-100']);
    expect(plan.listedOffers).toEqual(['tg-stars-50', 'tg-premium-3']);
    expect(plan.unknownSkus).toEqual(['telegram:stars:5000']);
  });

  it('does not let an offer id shared by two games list the wrong one', () => {
    /* `3` is a Premium duration and could as well be a Stars package id. The
     * category is part of the identity, so the venue listing Premium's `3`
     * says nothing about a Stars offer that happens to share the number. */
    const plan = planAvailability({
      supplierCode: TELEGRAM,
      catalog: [item('telegram:premium:3')],
      games: [
        { id: GAME_STARS, providerCategoryId: 'stars', providerOfferIds: ['3'] },
        { id: GAME_PREMIUM, providerCategoryId: 'premium', providerOfferIds: ['3'] },
      ],
      offers: [
        { id: 'tg-stars-3', providerOfferId: '3', providerCategoryId: 'stars' },
        { id: 'tg-premium-3', providerOfferId: '3', providerCategoryId: 'premium' },
      ],
    });

    expect(plan.listedOffers).toEqual(['tg-premium-3']);
    expect(plan.delistedOffers).toEqual(['tg-stars-3']);
    expect(plan.listedGames).toEqual([GAME_PREMIUM]);
    expect(plan.delistedGames).toEqual([GAME_STARS]);
  });

  it('treats a bare offer id from the venue as unknown, not as a match', () => {
    const plan = planAvailability({
      supplierCode: TELEGRAM,
      catalog: [item('50')],
      games: telegramGames(),
      offers: telegramOffers(),
    });

    expect(plan.listedOffers).toEqual([]);
    expect(plan.unknownSkus).toEqual(['50']);
  });
});

describe('TopUpCatalogSyncService', () => {
  it('delists an offer the venue stopped returning', async () => {
    const h = harness({ catalog: [sku(OFFER_STARS_50), sku(OFFER_STARS_100)] });

    const result = await h.service.sync();

    expect(h.store.isOfferListed(OFFER_PREMIUM_3M)).toBe(false);
    expect(h.store.isOfferListed(OFFER_STARS_50)).toBe(true);
    expect(result.offersDelisted).toBe(1);
    expect(result.suppliers).toEqual([SUPPLIER_CODE]);
  });

  it('delists a game whose every offer is gone', async () => {
    const h = harness({ catalog: [sku(OFFER_STARS_50), sku(OFFER_STARS_100)] });

    await h.service.sync();

    expect(h.store.isGameListed(GAME_PREMIUM)).toBe(false);
    expect(h.store.isGameListed(GAME_STARS)).toBe(true);
  });

  it('lists a newly added offer but leaves the operator’s switch OFF', async () => {
    /* The offer an operator has already put on sale, and the one arriving now.
     * The venue lists both; only the first may remain active. */
    const newOfferId = 'offer-stars-1000';
    const h = harness({
      catalog: [sku(OFFER_STARS_50), sku(newOfferId)],
      suppliers: [
        {
          id: SUPPLIER_ID,
          code: SUPPLIER_CODE,
          games: [
            {
              id: GAME_STARS,
              providerCategoryId: 'stars',
              providerOfferIds: [OFFER_STARS_50, newOfferId],
            },
          ],
          offers: [
            { id: OFFER_STARS_50, providerOfferId: OFFER_STARS_50, providerCategoryId: 'stars' },
            { id: newOfferId, providerOfferId: newOfferId, providerCategoryId: 'stars' },
          ],
        },
      ],
      activeOfferIds: [OFFER_STARS_50],
    });

    await h.service.sync();

    expect(h.store.isOfferListed(newOfferId)).toBe(true);
    expect(h.store.isOfferActive(newOfferId)).toBe(false);
    expect(h.store.isOfferActive(OFFER_STARS_50)).toBe(true);
  });

  it('never writes isActive, even for an offer it delists', async () => {
    const h = harness({
      catalog: [sku(OFFER_STARS_50)],
      activeOfferIds: [OFFER_STARS_100],
    });

    await h.service.sync();

    expect(h.store.isOfferListed(OFFER_STARS_100)).toBe(false);
    expect(h.store.isOfferActive(OFFER_STARS_100)).toBe(true);
  });

  it('writes nothing when a venue read fails, so a blip is not a mass delist', async () => {
    /* Every product starts listed. The venue then throws. A sync that wrote as
     * it went would have delisted all three before reaching the failure. */
    const h = harness({ catalog: [] });
    const failing = new MockSupplierProvider();
    failing.getCatalog = () => Promise.reject(new Error('venue unreachable'));
    const service = new TopUpCatalogSyncService(h.store, [failing], new AuditService({
      append: async () => undefined,
    }));

    await expect(service.sync()).rejects.toBeInstanceOf(BaratDomainException);

    expect(h.store.applied).toEqual([]);
    expect(h.store.isOfferListed(OFFER_STARS_50)).toBe(true);
    expect(h.store.isOfferListed(OFFER_STARS_100)).toBe(true);
    expect(h.store.isOfferListed(OFFER_PREMIUM_3M)).toBe(true);
    expect(h.store.isGameListed(GAME_STARS)).toBe(true);
    expect(h.store.isGameListed(GAME_PREMIUM)).toBe(true);
  });

  it('skips a supplier with no adapter rather than treating it as listing nothing', async () => {
    /* `providers: []` means no adapter is registered for this code. The read
     * never happens, so the catalogue must be untouched — delisting here would
     * take a whole supplier's catalogue offline over a missing flag. */
    const h = harness({ catalog: [sku(OFFER_STARS_50)], providers: [] });

    const result = await h.service.sync();

    expect(result.suppliers).toEqual([]);
    expect(h.store.applied).toEqual([]);
    expect(h.store.isOfferListed(OFFER_STARS_50)).toBe(true);
  });

  it('refuses an overlapping run instead of letting two plans fight', async () => {
    const h = harness({ catalog: [sku(OFFER_STARS_50)] });

    const first = h.service.sync();
    const overlap = await h.service.sync().catch((error: unknown) => error);
    await first;

    /* A conflict the admin can show, not a bare Error the filter turns into a 500. */
    expect(overlap).toBeInstanceOf(BaratDomainException);
    expect((overlap as BaratDomainException).status).toBe(409);
  });

  it('records one audit entry naming what changed and what the venue sells that we do not', async () => {
    const h = harness({ catalog: [sku(OFFER_STARS_50), sku('offer-upstream-only')] });

    await h.service.sync();

    expect(h.audits).toHaveLength(1);
    const entry = h.audits[0] as Record<string, unknown> | undefined;
    expect(entry?.action).toBe('TOP_UP_CATALOG_SYNCED');
    expect(entry?.entityId).toBe(SUPPLIER_CODE);
    const after = entry?.after as Record<string, unknown> | undefined;
    expect(after?.suppliers).toEqual([SUPPLIER_CODE]);
    expect(after?.offersListed).toBe(1);
    expect(after?.offersDelisted).toBe(2);
    expect(after?.unknownSkus).toEqual(['stars:offer-upstream-only']);
  });

  it('runs again after a failure, so a transient outage is not a stuck sync', async () => {
    const h = harness({ catalog: [sku(OFFER_STARS_50)] });
    const failing = new MockSupplierProvider();
    let shouldFail = true;
    failing.getCatalog = () => {
      if (shouldFail) return Promise.reject(new Error('venue unreachable'));
      return Promise.resolve([] as readonly SupplierCatalogItem[]);
    };
    const service = new TopUpCatalogSyncService(h.store, [failing], new AuditService({
      append: async () => undefined,
    }));

    await expect(service.sync()).rejects.toBeInstanceOf(BaratDomainException);
    shouldFail = false;
    await expect(service.sync()).resolves.toBeDefined();
  });

  describe('a supplier whose catalogue cannot be read', () => {
    /** What an adapter throws: a normalised code, the venue's status, and prose that must not travel. */
    const venueError = (code: string): Error =>
      Object.assign(new Error('venue said: rate limited for key abc123'), {
        name: 'VenueSupplierError',
        code,
        httpStatus: 429,
      });

    const failingProvider = (key: string, error: Error): SupplierProvider =>
      ({ key, getCatalog: () => Promise.reject(error) }) as unknown as SupplierProvider;

    it('answers 409 with the safe failure code — never the generic 500, never the venue prose', async () => {
      const h = harness();
      const service = new TopUpCatalogSyncService(
        h.store,
        [failingProvider(SUPPLIER_CODE, venueError('PROVIDER_RATE_LIMITED'))],
        new AuditService({ append: async () => undefined }),
      );

      const error = await service.sync().catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BaratDomainException);
      const domain = error as BaratDomainException;
      expect(domain.status).toBe(409);
      expect(domain.safeMessage).toContain('PROVIDER_RATE_LIMITED');
      expect(domain.safeMessage).not.toContain('abc123');
      expect(domain.message).not.toContain('abc123');
    });

    it('does not echo a code that does not look like one of ours', async () => {
      const h = harness();
      const service = new TopUpCatalogSyncService(
        h.store,
        [failingProvider(SUPPLIER_CODE, venueError('key=abc123 <b>'))],
        new AuditService({ append: async () => undefined }),
      );

      const error = (await service.sync().catch((caught: unknown) => caught)) as BaratDomainException;

      expect(error.status).toBe(409);
      expect(error.safeMessage).not.toContain('abc123');
    });

    it('still syncs the other suppliers and reports the one it could not read', async () => {
      const other: TopUpSyncableSupplier = {
        id: 'sup-other',
        code: 'other',
        games: [{ id: 'game-other', providerCategoryId: 'gems', providerOfferIds: ['offer-gems-1'] }],
        offers: [{ id: 'offer-gems-1', providerOfferId: 'offer-gems-1', providerCategoryId: 'gems' }],
      };
      const audits: Record<string, unknown>[] = [];
      const h = harness({ suppliers: [supplier(), other] });
      const service = new TopUpCatalogSyncService(
        h.store,
        [
          new MockSupplierProvider({ catalog: [sku(OFFER_STARS_50)] }),
          failingProvider('other', venueError('PROVIDER_RATE_LIMITED')),
        ],
        new AuditService({
          append: async (entry) => {
            audits.push(entry as unknown as Record<string, unknown>);
          },
        }),
      );

      const result = await service.sync();

      expect(result.suppliers).toEqual([SUPPLIER_CODE]);
      expect(result.failed).toEqual([{ supplierCode: 'other', code: 'PROVIDER_RATE_LIMITED' }]);
      /* The readable supplier was reconciled… */
      expect(h.store.isOfferListed(OFFER_STARS_100)).toBe(false);
      /* …and the unreadable one was not mistaken for a venue that lists nothing. */
      expect(h.store.isOfferListed('offer-gems-1')).toBe(true);
      expect(h.store.isGameListed('game-other')).toBe(true);
      expect(h.store.applied).toHaveLength(1);
      /* The audit entry exists; its fields are redacted by the audit layer (rule 10). */
      expect(audits).toHaveLength(1);
    });

    it('reports no failures on a clean run', async () => {
      const h = harness({ catalog: [sku(OFFER_STARS_50)] });

      const result = await h.service.sync();

      expect(result.failed).toEqual([]);
    });
  });
});
