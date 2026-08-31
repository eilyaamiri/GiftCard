import Decimal from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';
import { getProductResponseSchema, listProductsResponseSchema } from '@barat/contracts';

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
    });
    expect(call.select.skus.select).toEqual({ region: true });
    expect(JSON.stringify(response)).not.toContain(SUPPLIER_ID);
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
