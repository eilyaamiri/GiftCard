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

  it('narrows to one category, one brand and the review queue at once', async () => {
    const { service, product } = harness();

    await service.adminListProducts({
      page: 1,
      pageSize: 20,
      includeInactive: true,
      categoryId: 'cat_gaming',
      brandId: 'brnd_steam',
      needsReview: true,
    });

    // All three at once, because «برند X در دستهٔ Y که نیاز به بازبینی دارد» is
    // exactly how the import's leftovers get worked through.
    expect(product.findMany.mock.calls[0]?.[0]?.where).toEqual({
      categoryId: 'cat_gaming',
      brandId: 'brnd_steam',
      needsReview: true,
    });
  });

  it('lists everything when the review filter is left off', async () => {
    const { service, product } = harness();

    await service.adminListProducts({ page: 1, pageSize: 20, includeInactive: true });

    // `needsReview: false` would hide the rest of the catalog; absent means all.
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

/* ------------------------------------------------------- admin taxonomy */

/* Spelled out rather than partial: `adminCreateProduct` takes the schema's
 * parsed output, so this is the payload a route hands it once the defaults have
 * been applied. `brandId` and `categoryId` have no default — a product with
 * neither cannot be reached from the storefront, so creating one is refused. */
const NEW_PRODUCT = {
  slug: 'steam-us',
  title: 'Steam Wallet US',
  titleFa: 'استیم والت آمریکا',
  brandId: 'brnd_steam',
  categoryId: 'cat_gaming',
  extraCategoryIds: [],
  isActive: true,
  needsReview: false,
  isQuickPick: false,
  sortOrder: 0,
};

const KNOWN_CATEGORIES = [
  { id: 'cat_gaming', name: 'Gaming' },
  { id: 'cat_popular', name: 'Popular' },
];
const KNOWN_BRANDS = [
  { id: 'brnd_steam', name: 'Steam' },
  { id: 'brnd_valve', name: 'Valve' },
];

/**
 * Resolves an `id: { in: [...] }` lookup the way the database would. The row
 * type is deliberately loose so a test can also hand back a `_count` shape that
 * a different query on the same table selects.
 */
function lookupById(
  rows: readonly { id: string }[],
): (args: { where: { id: { in: string[] } } }) => Promise<Record<string, unknown>[]> {
  return (args) => Promise.resolve(rows.filter((row) => args.where.id.in.includes(row.id)));
}

/** A db double for the taxonomy writes: every one of them is a mutation. */
function adminHarness() {
  const category = {
    findMany: vi.fn(lookupById(KNOWN_CATEGORIES)),
    findUnique: vi.fn(),
    count: vi.fn().mockResolvedValue(1),
    create: vi.fn(),
    update: vi.fn(),
  };
  const brand = {
    findMany: vi.fn(lookupById(KNOWN_BRANDS)),
    findUnique: vi.fn().mockResolvedValue({ name: 'Steam' }),
    count: vi.fn().mockResolvedValue(1),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const product = {
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 2 }),
    findUnique: vi.fn().mockResolvedValue({ brandId: 'brnd_steam', categoryId: 'cat_gaming' }),
  };
  const productCategory = { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) };
  const db = {
    product,
    productCategory,
    category,
    brand,
    $transaction: async (operations: readonly Promise<unknown>[]) => Promise.all(operations),
  } as unknown as CatalogDatabase;
  return {
    service: new CatalogService(db, TEST_CONFIG),
    product,
    productCategory,
    category,
    brand,
  };
}

describe('CatalogService admin product taxonomy', () => {
  it('fills the supplier columns from the chosen brand and category', async () => {
    const { service, product } = adminHarness();

    await service.adminCreateProduct(NEW_PRODUCT);

    // Both columns are NOT NULL and a hand-made product has no supplier feed.
    expect(product.create.mock.calls[0]?.[0]?.data).toMatchObject({
      brandId: 'brnd_steam',
      categoryId: 'cat_gaming',
      brand: 'Steam',
      category: 'Gaming',
    });
  });

  it('keeps a supplier brand string the operator typed themselves', async () => {
    const { service, product } = adminHarness();

    await service.adminCreateProduct({ ...NEW_PRODUCT, brand: 'Steam (Valve Corp)' });

    // A re-import matches on this column, so an operator correcting it to the
    // feed's own spelling must not be overwritten by the relation's name.
    expect(product.create.mock.calls[0]?.[0]?.data?.brand).toBe('Steam (Valve Corp)');
  });

  it('refuses a category that is both the primary and a related one', async () => {
    const { service, product } = adminHarness();

    await expect(
      service.adminCreateProduct({ ...NEW_PRODUCT, extraCategoryIds: ['cat_gaming'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });

    // Otherwise the category tile would count this product twice.
    expect(product.create).not.toHaveBeenCalled();
  });

  it('refuses the same related category listed twice', async () => {
    const { service, product } = adminHarness();

    await expect(
      service.adminCreateProduct({
        ...NEW_PRODUCT,
        extraCategoryIds: ['cat_popular', 'cat_popular'],
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(product.create).not.toHaveBeenCalled();
  });

  it('refuses a brand id that does not exist', async () => {
    const { service, brand, product } = adminHarness();
    brand.findUnique.mockResolvedValue(null);

    await expect(service.adminCreateProduct(NEW_PRODUCT)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(product.create).not.toHaveBeenCalled();
  });

  it('checks a patch against the category already on the row', async () => {
    const { service, product } = adminHarness();

    // The patch only sends the related categories; the clash is with the
    // primary category stored on the product, which the payload never mentions.
    await expect(
      service.adminUpdateProduct('product-1', { extraCategoryIds: ['cat_gaming'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(product.update).not.toHaveBeenCalled();
  });

  it('replaces the related categories wholesale when the form sends them', async () => {
    const { service, product } = adminHarness();

    await service.adminUpdateProduct('product-1', { extraCategoryIds: ['cat_popular'] });

    // An unticked box has to remove its row, so the set is cleared first.
    expect(product.update.mock.calls[0]?.[0]?.data?.extraCategories).toEqual({
      deleteMany: {},
      create: [{ categoryId: 'cat_popular' }],
    });
  });

  it('leaves the related categories alone when the patch omits them', async () => {
    const { service, product } = adminHarness();

    await service.adminUpdateProduct('product-1', { isQuickPick: true });

    const data = product.update.mock.calls[0]?.[0]?.data;
    expect(data).toEqual({ isQuickPick: true });
    expect(data.extraCategories).toBeUndefined();
  });
});

describe('CatalogService admin category management', () => {
  it('reports the total and the active count for every category, empty ones included', async () => {
    const { service, category } = adminHarness();
    category.findMany
      .mockResolvedValueOnce([
        { ...categoryRow(), _count: { products: 3, productTags: 2 } },
        { ...categoryRow({ id: 'cat_empty', slug: 'empty' }), _count: { products: 0, productTags: 0 } },
      ])
      .mockResolvedValueOnce([
        { id: 'cat_gaming', _count: { products: 1, productTags: 1 } },
        { id: 'cat_empty', _count: { products: 0, productTags: 0 } },
      ]);

    const { items } = await service.adminListCategories();

    // An operator needs the empty one precisely because it is empty — the
    // public list is the one that hides it.
    expect(items.map((item) => [item.slug, item.productCount, item.activeProductCount])).toEqual([
      ['gaming', 5, 2],
      ['empty', 0, 0],
    ]);
  });

  it('deactivates a category instead of deleting it', async () => {
    const { service, category } = adminHarness();

    await service.adminArchiveCategory('cat_gaming');

    // A delete would null the categoryId of everything in it.
    expect(category.update.mock.calls[0]?.[0]).toEqual({
      where: { id: 'cat_gaming' },
      data: { isActive: false },
    });
  });

  it('refuses to make a category its own parent', async () => {
    const { service, category } = adminHarness();

    await expect(
      service.adminUpdateCategory('cat_gaming', { parentId: 'cat_gaming' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(category.update).not.toHaveBeenCalled();
  });

  it('clears the related tag before making a category the primary one', async () => {
    const { service, product, productCategory } = adminHarness();

    const result = await service.adminAssignCategory({
      productIds: ['product-1', 'product-2', 'product-1'],
      categoryId: 'cat_popular',
    });

    // Duplicates in the selection must not inflate the reported total.
    expect(result).toEqual({ requested: 2, updated: 2 });
    expect(productCategory.deleteMany.mock.calls[0]?.[0]?.where).toEqual({
      productId: { in: ['product-1', 'product-2'] },
      categoryId: 'cat_popular',
    });
    expect(product.updateMany.mock.calls[0]?.[0]?.data).toEqual({ categoryId: 'cat_popular' });
  });

  it('refuses to assign products to a category that does not exist', async () => {
    const { service, category, product } = adminHarness();
    category.count.mockResolvedValue(0);

    await expect(
      service.adminAssignCategory({ productIds: ['product-1'], categoryId: 'cat_ghost' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(product.updateMany).not.toHaveBeenCalled();
  });
});

describe('CatalogService admin brand merge', () => {
  it('moves the products across and then removes the emptied brand', async () => {
    const { service, product, brand } = adminHarness();

    const result = await service.adminMergeBrands({
      sourceBrandId: 'brnd_valve',
      targetBrandId: 'brnd_steam',
    });

    expect(result).toEqual({ movedProducts: 2, targetBrandId: 'brnd_steam' });
    expect(product.updateMany.mock.calls[0]?.[0]).toEqual({
      where: { brandId: 'brnd_valve' },
      // The free-text column follows, or a re-import would undo the merge.
      data: { brandId: 'brnd_steam', brand: 'Steam' },
    });
    expect(brand.delete.mock.calls[0]?.[0]).toEqual({ where: { id: 'brnd_valve' } });
  });

  it('refuses to merge a brand into itself', async () => {
    const { service, product, brand } = adminHarness();

    /* The route's pipe turns this into a VALIDATION_ERROR before the service is
     * reached; the `.parse` here is the second line of defence, and what it has
     * to guarantee is that nothing is written. */
    await expect(
      service.adminMergeBrands({ sourceBrandId: 'brnd_steam', targetBrandId: 'brnd_steam' }),
    ).rejects.toThrow('یک برند را نمی‌توان با خودش ادغام کرد.');
    expect(product.updateMany).not.toHaveBeenCalled();
    expect(brand.delete).not.toHaveBeenCalled();
  });

  it('touches nothing when one of the two brands is missing', async () => {
    const { service, product, brand } = adminHarness();

    await expect(
      service.adminMergeBrands({ sourceBrandId: 'brnd_gone', targetBrandId: 'brnd_steam' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Deleting first and failing to move is the loss the audit exists to stop.
    expect(product.updateMany).not.toHaveBeenCalled();
    expect(brand.delete).not.toHaveBeenCalled();
  });
});
