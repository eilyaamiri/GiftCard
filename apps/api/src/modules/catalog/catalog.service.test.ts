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
    needsReview: false,
    isQuickPick: true,
    sortOrder: 1,
    createdAt: CREATED_AT,
    brandRef: { slug: 'apple', nameFa: 'اپل' },
    categoryRef: { slug: 'popular', nameFa: 'عمومی و پرکاربرد', iconKey: 'sparkles' },
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
  const category = { findMany: vi.fn().mockResolvedValue([]) };
  const brand = { findMany: vi.fn().mockResolvedValue([]) };
  const db = {
    product,
    supplierOffer,
    category,
    brand,
    $transaction: async (operations: readonly Promise<unknown>[]) => Promise.all(operations),
  } as unknown as CatalogDatabase;
  return { service: new CatalogService(db, TEST_CONFIG), product, supplierOffer, category, brand };
}

function categoryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cat_gaming',
    slug: 'gaming',
    name: 'Gaming',
    nameFa: 'بازی و گیم',
    iconKey: 'gamepad-2',
    descriptionFa: null,
    parentId: null,
    sortOrder: 20,
    _count: { products: 3, productTags: 0 },
    ...overrides,
  };
}

function brandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'brnd_apple',
    slug: 'apple',
    name: 'Apple',
    nameFa: 'اپل',
    logoUrl: null,
    descriptionFa: null,
    isPopular: true,
    sortOrder: 0,
    _count: { products: 4 },
    ...overrides,
  };
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
    const skuClause = call.where.AND.find((clause: { skus?: unknown }) => clause.skus);
    expect(skuClause.skus.some.supplierOffers.some).toEqual({
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

describe('CatalogService taxonomy', () => {
  it('carries the brand and category keys the storefront navigates by', async () => {
    const { service } = harness();

    const response = await service.listProducts({ page: 1, pageSize: 20, onlyAvailable: true });

    expect(response.items[0]).toMatchObject({
      brandSlug: 'apple',
      brandNameFa: 'اپل',
      categorySlug: 'popular',
      categoryIconKey: 'sparkles',
      needsReview: false,
    });
    /* The contract's own shape still has to hold: the taxonomy keys are extra
     * fields on a valid `ProductDto`, not a different response. */
    expect(() => listProductsResponseSchema.parse(response)).not.toThrow();
  });

  it('finds a product through a secondary category, not only its primary one', async () => {
    const { service, product } = harness();

    await service.listProducts({
      page: 1,
      pageSize: 20,
      onlyAvailable: false,
      categorySlug: 'software',
    });

    const clause = product.findMany.mock.calls[0]?.[0].where.AND.find(
      (candidate: { OR?: unknown }) => candidate.OR,
    );
    expect(clause.OR).toEqual([
      { categoryRef: { slug: 'software' } },
      { extraCategories: { some: { category: { slug: 'software' } } } },
    ]);
  });

  it('keeps the search clause and the category clause apart', async () => {
    const { service, product } = harness();

    await service.listProducts({
      page: 1,
      pageSize: 20,
      onlyAvailable: false,
      categorySlug: 'gaming',
      search: 'استیم',
    });

    /* Both filters need an `OR` of their own. Written as one object literal the
     * second key would overwrite the first and the category would be ignored —
     * silently, with a plausible-looking page of results. */
    const ors = product.findMany.mock.calls[0]?.[0].where.AND.filter(
      (candidate: { OR?: unknown }) => candidate.OR,
    );
    expect(ors).toHaveLength(2);
  });

  it('searches the brand in Persian as well as in English', async () => {
    const { service, product } = harness();

    await service.listProducts({ page: 1, pageSize: 20, onlyAvailable: false, search: 'نتفلیکس' });

    const search = product.findMany.mock.calls[0]?.[0].where.AND[0];
    expect(search.OR).toContainEqual({ brandRef: { nameFa: { contains: 'نتفلیکس' } } });
  });

  it('hides a category with nothing in it', async () => {
    const { service, category } = harness();
    category.findMany.mockResolvedValue([
      categoryRow(),
      categoryRow({ id: 'cat_other', slug: 'other', _count: { products: 0, productTags: 0 } }),
    ]);

    const response = await service.listCategories();

    expect(response.items.map((item) => item.slug)).toEqual(['gaming']);
    expect(response.items[0]?.productCount).toBe(3);
  });

  it('counts a category by what browsing it will actually show', async () => {
    const { service, category } = harness();
    category.findMany.mockResolvedValue([categoryRow({ _count: { products: 3, productTags: 2 } })]);

    /* Two of the five are only tagged with this category, not filed under it.
     * The filter finds them, so the tile has to count them. */
    expect((await service.listCategories()).items[0]?.productCount).toBe(5);
  });

  it('counts only active products, whatever the category holds', async () => {
    const { service, category } = harness();
    await service.listCategories();

    expect(category.findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { isActive: true },
      select: {
        _count: {
          select: {
            products: { where: { isActive: true } },
            productTags: { where: { product: { isActive: true } } },
          },
        },
      },
    });
  });

  it('returns brands with their counts and drops the empty ones', async () => {
    const { service, brand } = harness();
    brand.findMany.mockResolvedValue([
      brandRow(),
      brandRow({ id: 'brnd_gone', slug: 'gone', isPopular: false, _count: { products: 0 } }),
    ]);

    const response = await service.listBrands();

    expect(response.items).toEqual([
      {
        id: 'brnd_apple',
        slug: 'apple',
        name: 'Apple',
        nameFa: 'اپل',
        logoUrl: null,
        descriptionFa: null,
        isPopular: true,
        sortOrder: 0,
        productCount: 4,
      },
    ]);
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
