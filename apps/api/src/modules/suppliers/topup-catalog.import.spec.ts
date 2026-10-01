import { describe, expect, it } from 'vitest';
import type { SupplierTopUpField, SupplierTopUpGame } from '@barat/suppliers';

import { BaratDomainException } from '../../common/errors/domain.exception';
import { AuditService, type AuditWriter } from '../audit/audit.service';
import { InMemoryTopUpCatalogImportStore } from './testing/in-memory-topup-catalog-import.store';
import {
  persianFieldLabel,
  slugifyGameName,
  TopUpCatalogImportService,
  TOP_UP_IMPORT_AUDIT_ACTION,
  uniqueSlug,
} from './topup-catalog.import';
import { TopUpImportRaceError, type TopUpCatalogReader } from './suppliers.types';

/**
 * ============================================================================
 * THE IMPORT'S CONTRACT: create what is missing, sell nothing
 * ============================================================================
 *
 *   1. Nothing it creates is on sale: new games and a new supplier are
 *      inactive, and a password game is flagged so the quote path refuses it.
 *   2. Nothing that exists is rewritten — an operator's name or switch survives
 *      a re-import.
 *   3. A dry run writes nothing and records nothing.
 *   4. It creates no work item: an import is not an order.
 */

const CODE = 'fazercards-topup';
const ACTOR = { id: 'staff-1', role: 'ADMIN' };

const text = (key: string, label: string, extra: Partial<SupplierTopUpField> = {}): SupplierTopUpField => ({
  key,
  label,
  type: 'TEXT',
  required: true,
  credential: false,
  ...extra,
});

const game = (
  categoryId: string,
  name: string,
  fields: readonly SupplierTopUpField[],
  offerIds: readonly string[] = ['60uc', '325uc'],
): SupplierTopUpGame => ({
  categoryId,
  name,
  region: 'GLOBAL',
  note: null,
  imageUrl: null,
  fields,
  offers: offerIds.map((offerId) => ({ offerId, name: `${name} ${offerId}`, cost: { amount: '0.99', currency: 'USD' } })),
  requiresCredentials: fields.some((field) => field.credential),
});

const PUBG = game('pubg_mobile', 'PUBG Mobile', [text('player_id', 'Player ID')]);
const MLBB = game('mlbb', 'Mobile Legends', [
  text('user_id', 'User ID'),
  text('zone_id', 'Zone ID', { pattern: '^[0-9]{4,5}$' }),
]);
const GENSHIN = game('genshin', 'Genshin Impact', [
  text('uid', 'UID'),
  {
    key: 'server',
    label: 'Server',
    type: 'SELECT',
    required: true,
    credential: false,
    options: [
      { label: 'Asia', value: 'os_asia' },
      { label: 'Europe', value: 'os_euro' },
    ],
  },
]);
const PASSWORD_GAME = game('fortnite', 'Fortnite V-Bucks', [
  text('email', 'Email'),
  text('password', 'Password', { credential: true }),
]);

function harness(catalog: readonly SupplierTopUpGame[] | Error = [PUBG, MLBB, GENSHIN, PASSWORD_GAME]) {
  const store = new InMemoryTopUpCatalogImportStore();
  const audits: unknown[] = [];
  const writer: AuditWriter = {
    append: async (entry) => {
      audits.push(entry);
    },
  };
  let reads = 0;
  const reader: TopUpCatalogReader = {
    supplierCode: CODE,
    supplierName: 'FazerCards Top-up',
    defaultCurrency: 'USD',
    readCatalog: async () => {
      reads += 1;
      if (catalog instanceof Error) {
        throw catalog;
      }
      return catalog;
    },
  };
  const service = new TopUpCatalogImportService(store, [reader], new AuditService(writer));
  const run = (dryRun: boolean) => service.import({ supplierCode: CODE, dryRun, actor: ACTOR });
  return { store, audits, service, run, reads: () => reads };
}

describe('TopUpCatalogImportService — what it creates', () => {
  it('creates every sellable-shaped game inactive, under an inactive supplier', async () => {
    const h = harness();

    const result = await h.run(false);

    expect(result.supplierCreated).toBe(true);
    expect(h.store.suppliers.get(CODE)?.isActive).toBe(false);
    expect(h.store.games.map((row) => row.providerCategoryId)).toEqual(['pubg_mobile', 'mlbb', 'genshin', 'fortnite']);
    expect(h.store.games.every((row) => !row.isActive)).toBe(true);
    expect(result.totals).toEqual({ newGames: 4, newOffers: 8, credentialGames: 1, skipped: 0 });
  });

  it('creates a new game offers active, so its review is a single decision', async () => {
    const h = harness([PUBG]);

    await h.run(false);

    expect(h.store.game('pubg_mobile')?.offers.map((offer) => offer.isActive)).toEqual([true, true]);
  });

  it('keeps a user-id-only game to its one field', async () => {
    const h = harness([PUBG]);

    await h.run(false);

    expect(h.store.game('pubg_mobile')?.fields).toEqual([
      {
        key: 'player_id',
        label: 'Player ID',
        labelFa: 'شناسه بازیکن',
        fieldType: 'TEXT',
        isRequired: true,
        options: null,
        validationRegex: null,
        sortOrder: 0,
      },
    ]);
  });

  it('imports a user id plus a typed server id, keeping the venue pattern', async () => {
    const h = harness([MLBB]);

    await h.run(false);

    const fields = h.store.game('mlbb')?.fields ?? [];
    expect(fields.map((field) => [field.key, field.labelFa, field.fieldType, field.validationRegex])).toEqual([
      ['user_id', 'شناسه بازیکن', 'TEXT', null],
      ['zone_id', 'شناسه سرور', 'TEXT', '^[0-9]{4,5}$'],
    ]);
  });

  it('imports a user id plus a server picked from the venue list', async () => {
    const h = harness([GENSHIN]);

    await h.run(false);

    const server = h.store.game('genshin')?.fields[1];
    expect(server).toMatchObject({ key: 'server', labelFa: 'سرور', fieldType: 'SELECT' });
    expect(server?.options).toEqual([
      { label: 'Asia', value: 'os_asia' },
      { label: 'Europe', value: 'os_euro' },
    ]);
  });

  it('flags a game that wants a password, and never activates it', async () => {
    const h = harness([PASSWORD_GAME]);

    const result = await h.run(false);

    expect(h.store.game('fortnite')).toMatchObject({ requiresCredentials: true, isActive: false });
    expect(result.games[0]).toMatchObject({ status: 'NEW', requiresCredentials: true });
    expect(result.games[0]?.fields.find((field) => field.key === 'password')?.credential).toBe(true);
  });

  it('reports the venue price but hands the store no cost', async () => {
    const h = harness([PUBG]);

    const result = await h.run(false);

    expect(result.games[0]?.offers[0]?.cost).toEqual({ amount: '0.99', currency: 'USD' });
    expect(JSON.stringify(h.store.games)).not.toContain('0.99');
  });
});

describe('TopUpCatalogImportService — what it leaves alone', () => {
  it('never rewrites an existing game, and adds its new offers inactive', async () => {
    const h = harness([PUBG]);
    h.store.seedSupplier(CODE, true);
    h.store.seedGame({
      supplierCode: CODE,
      providerCategoryId: 'pubg_mobile',
      slug: 'pubg',
      name: 'پابجی موبایل',
      isActive: true,
      offers: [{ providerOfferId: '60uc', name: '۶۰ یوسی', isActive: false }],
    });

    const result = await h.run(false);

    const pubg = h.store.game('pubg_mobile');
    expect(pubg).toMatchObject({ slug: 'pubg', name: 'پابجی موبایل', isActive: true });
    expect(pubg?.offers).toEqual([
      { providerOfferId: '60uc', name: '۶۰ یوسی', isActive: false },
      { providerOfferId: '325uc', name: 'PUBG Mobile 325uc', isActive: false },
    ]);
    expect(result.games[0]).toMatchObject({ status: 'EXISTING', newOffers: 1, slug: null });
    expect(result.supplierCreated).toBe(false);
  });

  it('keeps an existing supplier switched the way the operator left it', async () => {
    const h = harness([PUBG]);
    h.store.seedSupplier(CODE, true);

    await h.run(false);

    expect(h.store.suppliers.get(CODE)?.isActive).toBe(true);
  });

  it('is a no-op the second time', async () => {
    const h = harness();
    await h.run(false);

    const again = await h.run(false);

    expect(again.totals).toEqual({ newGames: 0, newOffers: 0, credentialGames: 0, skipped: 0 });
    expect(h.store.games).toHaveLength(4);
  });
});

describe('TopUpCatalogImportService — what it skips', () => {
  it.each([
    ['a game with nothing on sale', game('empty', 'Empty Game', [text('player_id', 'Player ID')], []), 'NO_OFFERS'],
    ['a game with no account field', game('nofield', 'No Field Game', []), 'NO_ACCOUNT_FIELDS'],
    ['Telegram, by name', game('tg', 'Telegram Stars', [text('username', 'Username')]), 'SERVED_BY_TELEGRAM_SUPPLIER'],
    ['Telegram, by id', game('telegram_premium', 'Premium', [text('username', 'Username')]), 'SERVED_BY_TELEGRAM_SUPPLIER'],
  ])('skips %s', async (_label, row, reason) => {
    const h = harness([row]);

    const result = await h.run(false);

    expect(result.games[0]).toMatchObject({ status: 'SKIPPED', skipReason: reason });
    expect(result.totals.skipped).toBe(1);
    expect(h.store.games).toHaveLength(0);
  });

  it('creates one game for a category the venue repeats', async () => {
    const h = harness([PUBG, PUBG]);

    await h.run(false);

    expect(h.store.games).toHaveLength(1);
  });
});

describe('TopUpCatalogImportService — dry run', () => {
  it('reports the same plan and writes nothing', async () => {
    const h = harness();

    const dry = await h.run(true);

    expect(dry.dryRun).toBe(true);
    expect(dry.totals).toEqual({ newGames: 4, newOffers: 8, credentialGames: 1, skipped: 0 });
    expect(dry.games.map((row) => row.slug)).toEqual([
      'pubg-mobile',
      'mobile-legends',
      'genshin-impact',
      'fortnite-v-bucks',
    ]);
    expect(h.store.applyCalls).toBe(0);
    expect(h.store.suppliers.size).toBe(0);
    expect(h.audits).toHaveLength(0);
  });
});

describe('TopUpCatalogImportService — audit, failures and guards', () => {
  it('records one audit entry for a real run, attributed to the staff member', async () => {
    const h = harness([PUBG]);

    await h.run(false);

    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      actor: 'staff-1',
      actorType: 'STAFF',
      actorRole: 'ADMIN',
      action: TOP_UP_IMPORT_AUDIT_ACTION,
      entity: 'Supplier',
      entityId: CODE,
    });
  });

  it('writes nothing when the venue read fails, and answers with a safe message', async () => {
    const h = harness(new Error('connect ECONNREFUSED'));

    const error = await h.run(false).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BaratDomainException);
    expect((error as BaratDomainException).status).toBe(409);
    expect((error as BaratDomainException).safeMessage).not.toContain('ECONNREFUSED');
    expect((error as BaratDomainException).message).not.toContain('ECONNREFUSED');
    expect(h.store.applyCalls).toBe(0);
    expect(h.audits).toHaveLength(0);
  });

  it('turns a concurrent write into a conflict and records nothing', async () => {
    const h = harness([PUBG]);
    h.store.failApply = new TopUpImportRaceError();

    await expect(h.run(false)).rejects.toMatchObject({ status: 409 });
    expect(h.audits).toHaveLength(0);
  });

  it('lets any other store failure through untouched', async () => {
    const h = harness([PUBG]);
    h.store.failApply = new Error('database is down');

    await expect(h.run(false)).rejects.toThrow('database is down');
  });

  it('refuses a supplier it has no reader for', async () => {
    const h = harness();

    await expect(
      h.service.import({ supplierCode: 'reloadly', dryRun: true, actor: ACTOR }),
    ).rejects.toMatchObject({ status: 503 });
    expect(h.reads()).toBe(0);
  });

  it('refuses a second run while one is in flight', async () => {
    let release: (games: readonly SupplierTopUpGame[]) => void = () => undefined;
    let calls = 0;
    const store = new InMemoryTopUpCatalogImportStore();
    const service = new TopUpCatalogImportService(
      store,
      [
        {
          supplierCode: CODE,
          supplierName: 'FazerCards Top-up',
          defaultCurrency: 'USD',
          readCatalog: () => {
            calls += 1;
            /* Only the first read hangs; the one after the guard is released answers at once. */
            return calls === 1 ? new Promise((resolve) => (release = resolve)) : Promise.resolve([PUBG]);
          },
        },
      ],
      new AuditService({ append: async () => undefined }),
    );

    const first = service.import({ supplierCode: CODE, dryRun: false, actor: ACTOR });
    await expect(service.import({ supplierCode: CODE, dryRun: true, actor: ACTOR })).rejects.toMatchObject({
      status: 409,
    });
    release([PUBG]);
    await expect(first).resolves.toMatchObject({ totals: { newGames: 1 } });

    // The guard is released afterwards.
    await expect(service.import({ supplierCode: CODE, dryRun: true, actor: ACTOR })).resolves.toBeDefined();
  });

  it('touches nothing on the reader but its catalogue read', async () => {
    const touched: string[] = [];
    const reader = new Proxy(
      {
        supplierCode: CODE,
        supplierName: 'FazerCards Top-up',
        defaultCurrency: 'USD',
        readCatalog: async () => [PUBG],
      } satisfies TopUpCatalogReader,
      {
        get(target, property, receiver) {
          touched.push(String(property));
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    // The service is built from an import store, a reader and an audit log —
    // no work-item service and no purchase method exist for it to reach.
    const service = new TopUpCatalogImportService(
      new InMemoryTopUpCatalogImportStore(),
      [reader],
      new AuditService({ append: async () => undefined }),
    );

    await service.import({ supplierCode: CODE, dryRun: false, actor: ACTOR });

    expect(new Set(touched)).toEqual(new Set(['supplierCode', 'supplierName', 'defaultCurrency', 'readCatalog']));
  });
});

describe('slugs', () => {
  it.each([
    ['PUBG Mobile (Global)', 'pubg_mobile', 'pubg-mobile-global'],
    ['Free Fire — Diamonds', 'ff', 'free-fire-diamonds'],
    ['Café Game', 'cafe', 'cafe-game'],
    ['پابجی', 'pubg_mobile', 'game-pubg-mobile'],
    ['پابجی', '***', 'game'],
  ])('slugifies %s', (name, categoryId, expected) => {
    expect(slugifyGameName(name, categoryId)).toBe(expected);
  });

  it('caps the slug at the schema limit without a trailing dash', () => {
    const slug = slugifyGameName(`${'a'.repeat(89)} b`, 'x');

    expect(slug.length).toBeLessThanOrEqual(90);
    expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
  });

  it('numbers a slug that is already taken, across suppliers', async () => {
    const h = harness([PUBG]);
    h.store.foreignSlugs.add('pubg-mobile');
    h.store.foreignSlugs.add('pubg-mobile-2');

    const result = await h.run(false);

    expect(result.games[0]?.slug).toBe('pubg-mobile-3');
  });

  it('keeps a numbered slug inside the length limit', () => {
    const long = 'a'.repeat(90);

    expect(uniqueSlug(long, new Set([long]))).toBe(`${'a'.repeat(88)}-2`);
  });
});

describe('persianFieldLabel', () => {
  it.each([
    [text('player_id', 'Player ID'), 'شناسه بازیکن'],
    [text('uid', 'UID'), 'شناسه بازیکن'],
    [text('user_id', 'User ID'), 'شناسه بازیکن'],
    [text('zone_id', 'Zone ID'), 'شناسه سرور'],
    [text('server_id', 'Server ID'), 'شناسه سرور'],
    [{ ...text('server', 'Server'), type: 'SELECT' as const }, 'سرور'],
    [text('nickname', 'Nickname'), null],
  ])('labels %o', (field, expected) => {
    expect(persianFieldLabel(field)).toBe(expected);
  });
});
