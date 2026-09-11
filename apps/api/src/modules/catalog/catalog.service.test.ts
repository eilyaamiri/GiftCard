import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import {
  QUOTABLE_COST_CURRENCIES,
  getProductResponseSchema,
  listProductsResponseSchema,
} from '@barat/contracts';

vi.mock('@barat/database', () => ({
  Prisma: { JsonNull: null },
}));

import type { AppConfigService } from '../../common/config/app-config.service';
import type { CatalogDatabase } from './catalog.tokens';
import { CatalogService } from './catalog.service';

const TEST_CONFIG = { productImageDir: '/tmp/baratpay-catalog-tests' } as AppConfigService;

const CREATED_AT = new Date('2026-08-30T10:00:00.000Z');
const SUPPLIER_ID = 'supplier-private-tillo';
const OFFER_ID = 'offer-private-42';
const SUPPLIER_COST = '46.512345';

function productRow() {
  return {
    id: 'product-1',
    slug: 'apple-us',
    brand: 'Apple',
    title: 'Apple Gift Card',
    titleFa: 'گیفت کارت اپل',
    description: 'US gift card',
    descriptionFa: 'گیفت کارت آمریکا',
    category: 'gift-card',
    imageUrl: null,
    redemptionNotesFa: 'فقط برای حساب آمریکا',
    isActive: true,
    sortOrder: 1,
    createdAt: CREATED_AT,
    skus: [
      {
        id: 'sku-1',
        productId: 'product-1',
        code: 'APPLE-US-50',
        region: 'US',
        currency: 'USD',
        faceValue: new Decimal('50'),
        denominationLabel: '$50',
        deliveryAssetType: 'CODE',
        isActive: true,
        minQuantity: 1,
        maxQuantity: 10,
        /* A deliberately hostile fake: a real Prisma `select` would omit these.
         * The mapper must still never copy them to the public DTO. */
        supplierOffers: [
          {
            id: OFFER_ID,
            supplierId: SUPPLIER_ID,
            costAmount: new Decimal(SUPPLIER_COST),
          },
        ],
      },
    ],
  };
}

function harness() {
  const row = productRow();
  const product = {
    findMany: vi.fn().mockResolvedValue([row]),
    count: vi.fn().mockResolvedValue(1),
    findFirst: vi.fn().mockResolvedValue(row),
  };
  const supplierOffer = {
    findMany: vi.fn().mockResolvedValue([{ skuId: 'sku-1' }]),
  };
  const db = {
    product,
    supplierOffer,
    $transaction: async (operations: readonly Promise<unknown>[]) => Promise.all(operations),
  } as unknown as CatalogDatabase;
  return { service: new CatalogService(db, TEST_CONFIG), product, supplierOffer };
}

describe('CatalogService public projections', () => {
  it('returns a contract-valid product wrapper with no supplier identity or cost', async () => {
    const { service } = harness();

    const response = await service.getProduct('apple-us');
    expect(() => getProductResponseSchema.parse(response)).not.toThrow();
    expect(response.product.skus[0]).toMatchObject({ faceValue: '50', isAvailable: true });

    const serialized = JSON.stringify(response);
    for (const privateValue of [SUPPLIER_ID, OFFER_ID, SUPPLIER_COST, 'supplierOffers']) {
      expect(serialized).not.toContain(privateValue);
    }
  });

  it('only counts a SKU available when its offer is priced in a quotable currency', async () => {
    const { service, supplierOffer } = harness();

    await service.getProduct('apple-us');

    /* A GBP-only SKU has no FX pair, so the quote engine would refuse it. If the
     * availability probe ignored currency the storefront would offer the card
     * and then drop the customer on an error page after they pressed buy. */
    expect(supplierOffer.findMany.mock.calls[0]?.[0]?.where).toEqual({
      skuId: { in: ['sku-1'] },
      isActive: true,
      availability: 'AVAILABLE',
      supplier: { isActive: true },
      costCurrency: { in: [...QUOTABLE_COST_CURRENCIES] },
    });
    expect(QUOTABLE_COST_CURRENCIES).not.toContain('GBP');
  });

  it('filters onlyAvailable at the database boundary without selecting offers', async () => {
    const { service, product } = harness();

    const response = await service.listProducts({
      page: 1,
      pageSize: 20,
      onlyAvailable: true,
    });

    expect(() => listProductsResponseSchema.parse(response)).not.toThrow();
    const call = product.findMany.mock.calls[0]?.[0];
    expect(call.where.skus.some.supplierOffers.some).toEqual({
      isActive: true,
      availability: 'AVAILABLE',
      supplier: { isActive: true },
      // An offer priced in a currency with no FX pair cannot be quoted, so it
      // must not make a product look buyable.
      costCurrency: { in: [...QUOTABLE_COST_CURRENCIES] },
    });
    expect(call.select.skus.select).toEqual({ region: true });
    expect(JSON.stringify(response)).not.toContain(SUPPLIER_ID);
  });
});

describe('CatalogService admin product list', () => {
  /* The imported supplier catalog is ~2,400 products, all switched off. An
   * operator reaches one of them by searching for it, so these assert on the
   * `where` the search builds rather than on rows a mock hands back. */

  it('pages from the offset the caller asked for, and reports the page back', async () => {
    const { service, product } = harness();
    product.count.mockResolvedValue(2_406);

    const response = await service.adminListProducts({
      page: 5,
      pageSize: 20,
      includeInactive: true,
    });

    expect(product.findMany.mock.calls[0]?.[0]).toMatchObject({ skip: 80, take: 20 });
    expect(response.meta).toEqual({ page: 5, pageSize: 20, total: 2_406, totalPages: 121 });
  });

  it('searches the product name and the id together', async () => {
    const { service, product } = harness();

    await service.adminListProducts({
      page: 1,
      pageSize: 20,
      includeInactive: true,
      search: '14971',
    });

    // `contains` on the id, not equality: the operator has the supplier's own
    // product number, not our prefixed row id.
    expect(product.findMany.mock.calls[0]?.[0]?.where).toEqual({
      OR: [
        { id: { contains: '14971', mode: 'insensitive' } },
        { title: { contains: '14971', mode: 'insensitive' } },
        { titleFa: { contains: '14971' } },
      ],
    });
  });

  it('keeps the inactive filter alongside a search term', async () => {
    const { service, product } = harness();

    await service.adminListProducts({
      page: 1,
      pageSize: 20,
      includeInactive: false,
      search: 'apple',
    });

    // Both clauses, not one replacing the other: a search must not start
    // surfacing archived products on a screen that excludes them.
    const where = product.findMany.mock.calls[0]?.[0]?.where;
    expect(where.isActive).toBe(true);
    expect(where.OR).toHaveLength(3);
  });

  it('filters inactive products when the explicit status is inactive', async () => {
    const { service, product } = harness();

    await service.adminListProducts({
      page: 1,
      pageSize: 20,
      includeInactive: true,
      status: 'INACTIVE',
    });

    expect(product.findMany.mock.calls[0]?.[0]?.where).toEqual({ isActive: false });
    expect(product.count.mock.calls[0]?.[0]?.where).toEqual({ isActive: false });
  });

  it('applies no search clause when the term is empty', async () => {
    const { service, product } = harness();

    await service.adminListProducts({
      page: 1,
      pageSize: 20,
      includeInactive: true,
      search: '',
    });

    // `?search=` must list the catalog, not match every row against '%%'.
    expect(product.findMany.mock.calls[0]?.[0]?.where).toEqual({});
  });

  it('counts with the same filter it lists with', async () => {
    const { service, product } = harness();

    await service.adminListProducts({
      page: 2,
      pageSize: 20,
      includeInactive: true,
      search: 'steam',
    });

    // A total taken from an unfiltered count would put a "page 2 of 121" pager
    // under a single search result.
    expect(product.count.mock.calls[0]?.[0]?.where).toEqual(
      product.findMany.mock.calls[0]?.[0]?.where,
    );
  });
});

describe('CatalogService admin service bounds', () => {
  it('checks a partial bound update against the value already stored', async () => {
    const update = vi.fn();
    const db = {
      internationalService: {
        findUnique: vi.fn().mockResolvedValue({
          minAmount: new Decimal('5'),
          maxAmount: new Decimal('10'),
        }),
        update,
      },
    } as unknown as CatalogDatabase;
    const service = new CatalogService(db, TEST_CONFIG);

    await expect(
      service.adminUpdateService('service-1', { minAmount: '11' }),
    ).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(update).not.toHaveBeenCalled();
  });
});
