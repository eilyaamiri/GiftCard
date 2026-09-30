import { afterEach, describe, expect, it, vi } from 'vitest';

import { isStalePurchasingClaim } from './suppliers.types';

describe('isStalePurchasingClaim', () => {
  const now = new Date('2026-09-30T12:00:00.000Z');

  it('does not recover a fresh claim while its provider POST may still run', () => {
    expect(isStalePurchasingClaim(new Date('2026-09-30T11:59:59.999Z'), now)).toBe(false);
  });

  it('recovers a claim older than the provider-request grace period', () => {
    expect(isStalePurchasingClaim(new Date('2026-09-30T11:54:59.999Z'), now)).toBe(true);
  });

  it('does not guess at an unclaimed/legacy row with no start time', () => {
    expect(isStalePurchasingClaim(null, now)).toBe(false);
  });
});

/*
 * The import store's writes, against a recorded transaction client. What is
 * asserted is the create-only shape: an existing supplier row is never
 * updated, every created game is inactive, and no real cost is stored.
 */
describe('PrismaTopUpCatalogImportStore.applyImport', () => {
  const importedAt = new Date('2026-09-30T12:00:00.000Z');

  function recordingTx(existingGameIds: readonly string[] = []) {
    const calls: { model: string; op: string; args: unknown }[] = [];
    const record = (model: string, op: string, result: unknown) => async (args: unknown) => {
      calls.push({ model, op, args });
      return result;
    };
    const tx = {
      supplier: { upsert: record('supplier', 'upsert', { id: 'sup-1' }) },
      topUpGame: {
        create: record('topUpGame', 'create', { id: 'new-game' }),
        findFirst: async (args: { where: { id: string } }) => {
          calls.push({ model: 'topUpGame', op: 'findFirst', args });
          return existingGameIds.includes(args.where.id) ? { id: args.where.id } : null;
        },
      },
      topUpOffer: { createMany: record('topUpOffer', 'createMany', { count: 1 }) },
    };
    return { tx, calls };
  }

  async function storeWith(transaction: (fn: (tx: unknown) => Promise<void>) => Promise<void>) {
    vi.resetModules();
    vi.doMock('@barat/database', () => ({ prisma: { $transaction: transaction } }));
    const { PrismaTopUpCatalogImportStore } = await import('./prisma-topup.store');
    return new PrismaTopUpCatalogImportStore();
  }

  const input = {
    supplier: { code: 'fazercards-topup', name: 'FazerCards Top-up', defaultCurrency: 'USD' },
    newGames: [
      {
        providerCategoryId: 'mlbb',
        slug: 'mobile-legends',
        name: 'Mobile Legends',
        region: 'GLOBAL',
        imageUrl: null,
        providerNote: null,
        requiresCredentials: false,
        sortOrder: 0,
        fields: [
          {
            key: 'user_id',
            label: 'User ID',
            labelFa: 'شناسه بازیکن',
            fieldType: 'TEXT' as const,
            isRequired: true,
            options: null,
            validationRegex: null,
            sortOrder: 0,
          },
          {
            key: 'server',
            label: 'Server',
            labelFa: 'سرور',
            fieldType: 'SELECT' as const,
            isRequired: true,
            options: [{ label: 'Asia', value: 'asia' }],
            validationRegex: null,
            sortOrder: 1,
          },
        ],
        offers: [{ providerOfferId: '86', name: '86 Diamonds', sortOrder: 0, isActive: true }],
      },
    ],
    newOffers: [
      { gameId: 'game-pubg', offers: [{ providerOfferId: '325uc', name: '325 UC', sortOrder: 1, isActive: false }] },
    ],
    importedAt,
  };

  /* `resetModules` loads a fresh copy of the error class, so it is matched by name. */
  afterEach(() => {
    vi.doUnmock('@barat/database');
    vi.resetModules();
  });

  it('creates a missing supplier inactive and never updates an existing one', async () => {
    const { tx, calls } = recordingTx(['game-pubg']);
    const store = await storeWith(async (fn) => fn(tx));

    await store.applyImport(input);

    const upsert = calls.find((call) => call.op === 'upsert')?.args as {
      create: { isActive: boolean; integrationMode: string };
      update: unknown;
    };
    expect(upsert.create).toMatchObject({ isActive: false, integrationMode: 'API' });
    expect(upsert.update).toEqual({});
  });

  it('creates games inactive, with their fields, and stores no real cost', async () => {
    const { tx, calls } = recordingTx(['game-pubg']);
    const store = await storeWith(async (fn) => fn(tx));

    await store.applyImport(input);

    const created = calls.find((call) => call.op === 'create')?.args as {
      data: {
        isActive: boolean;
        supplierId: string;
        fields: { create: { key: string; options?: unknown }[] };
        offers: { create: { costAmount: string; isActive: boolean }[] };
      };
    };
    expect(created.data).toMatchObject({ isActive: false, supplierId: 'sup-1' });
    expect(created.data.fields.create.map((field) => field.key)).toEqual(['user_id', 'server']);
    expect(created.data.fields.create[0]).not.toHaveProperty('options');
    expect(created.data.fields.create[1]?.options).toEqual([{ label: 'Asia', value: 'asia' }]);
    expect(created.data.offers.create).toEqual([
      expect.objectContaining({ costAmount: '0', isActive: true }),
    ]);
  });

  it('adds new offers to an existing game inactive, scoped to the supplier', async () => {
    const { tx, calls } = recordingTx(['game-pubg']);
    const store = await storeWith(async (fn) => fn(tx));

    await store.applyImport(input);

    const lookup = calls.find((call) => call.op === 'findFirst')?.args;
    expect(lookup).toMatchObject({ where: { id: 'game-pubg', supplierId: 'sup-1' } });
    const createMany = calls.find((call) => call.op === 'createMany')?.args as {
      data: { gameId: string; isActive: boolean; costAmount: string }[];
    };
    expect(createMany.data).toEqual([
      expect.objectContaining({ gameId: 'game-pubg', isActive: false, costAmount: '0' }),
    ]);
  });

  it('refuses to attach offers to a game that is not this supplier', async () => {
    const { tx } = recordingTx([]);
    const store = await storeWith(async (fn) => fn(tx));

    await expect(store.applyImport(input)).rejects.toMatchObject({ name: 'TopUpImportRaceError' });
  });

  it('reports a unique-key collision as a race', async () => {
    const store = await storeWith(async () => {
      throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
    });

    await expect(store.applyImport(input)).rejects.toMatchObject({ name: 'TopUpImportRaceError' });
  });

  it('lets any other database failure through', async () => {
    const store = await storeWith(async () => {
      throw new Error('connection reset');
    });

    await expect(store.applyImport(input)).rejects.toThrow('connection reset');
  });
});
