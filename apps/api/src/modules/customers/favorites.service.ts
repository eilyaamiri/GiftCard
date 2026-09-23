import { Inject, Injectable } from '@nestjs/common';

import { DomainErrors } from '../../common/errors/domain.exception';
import type { AddFavoriteRequest } from '../identity/identity.schemas';
import { CUSTOMERS_DATABASE, type CustomersDatabase } from './customers.tokens';
import type { AccountFavoriteDto, FavoriteItemType } from './customers.types';

/**
 * `/api/account/favorites` — the signed-in customer's starred gift cards and
 * international services.
 *
 * `CustomerFavorite` stores only `itemType` and `itemSlug`; every other field on
 * `AccountFavoriteDto` is resolved here, at read time, from the catalog. That
 * keeps a favorite in sync with the product it points at for free (a renamed
 * product shows its new name) and means a deleted product just disappears from
 * the list instead of leaving a dangling reference to clean up.
 */
@Injectable()
export class FavoritesService {
  constructor(@Inject(CUSTOMERS_DATABASE) private readonly database: CustomersDatabase) {}

  async list(customerId: string): Promise<readonly AccountFavoriteDto[]> {
    const favorites = await this.database.customerFavorite.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    if (favorites.length === 0) return [];

    const productSlugs = favorites
      .filter((favorite) => favorite.itemType === 'PRODUCT')
      .map((favorite) => favorite.itemSlug);
    const serviceSlugs = favorites
      .filter((favorite) => favorite.itemType === 'SERVICE')
      .map((favorite) => favorite.itemSlug);

    const [products, services] = await Promise.all([
      productSlugs.length > 0
        ? this.database.product.findMany({
            where: { slug: { in: productSlugs } },
            select: {
              slug: true,
              titleFa: true,
              brand: true,
              brandRef: { select: { slug: true } },
            },
          })
        : [],
      serviceSlugs.length > 0
        ? this.database.internationalService.findMany({
            where: { slug: { in: serviceSlugs } },
            select: { slug: true, nameFa: true, category: true },
          })
        : [],
    ]);
    const productBySlug = new Map(products.map((product) => [product.slug, product]));
    const serviceBySlug = new Map(services.map((service) => [service.slug, service]));

    /* A favorite whose product or service was since deleted resolves to
     * nothing here and is dropped rather than shown broken. */
    return favorites.flatMap((favorite): AccountFavoriteDto[] => {
      if (favorite.itemType === 'PRODUCT') {
        const product = productBySlug.get(favorite.itemSlug);
        if (!product) return [];
        return [
          {
            itemType: 'PRODUCT',
            itemSlug: favorite.itemSlug,
            titleFa: product.titleFa,
            href: `/gift-cards/${favorite.itemSlug}`,
            brand: product.brand,
            brandSlug: product.brandRef?.slug ?? null,
            category: null,
            createdAt: favorite.createdAt.toISOString(),
          },
        ];
      }
      const service = serviceBySlug.get(favorite.itemSlug);
      if (!service) return [];
      return [
        {
          itemType: 'SERVICE',
          itemSlug: favorite.itemSlug,
          titleFa: service.nameFa,
          href: `/services/${favorite.itemSlug}`,
          brand: null,
          brandSlug: null,
          category: service.category,
          createdAt: favorite.createdAt.toISOString(),
        },
      ];
    });
  }

  async add(customerId: string, input: AddFavoriteRequest): Promise<AccountFavoriteDto> {
    const exists =
      input.itemType === 'PRODUCT'
        ? await this.database.product.findUnique({ where: { slug: input.itemSlug }, select: { slug: true } })
        : await this.database.internationalService.findUnique({
            where: { slug: input.itemSlug },
            select: { slug: true },
          });
    if (!exists) {
      throw DomainErrors.notFound(input.itemType === 'PRODUCT' ? 'Product' : 'InternationalService');
    }

    const row = await this.database.customerFavorite.upsert({
      where: {
        customerId_itemType_itemSlug: { customerId, itemType: input.itemType, itemSlug: input.itemSlug },
      },
      create: { customerId, itemType: input.itemType, itemSlug: input.itemSlug },
      update: {},
    });

    const [hydrated] = await this.hydrateOne(input.itemType, input.itemSlug, row.createdAt);
    /* `exists` above already proved the row is there; this can only fail if the
     * product/service was archived in the instant between the two queries. */
    if (!hydrated) throw DomainErrors.notFound(input.itemType === 'PRODUCT' ? 'Product' : 'InternationalService');
    return hydrated;
  }

  async remove(customerId: string, itemType: FavoriteItemType, itemSlug: string): Promise<{ removed: boolean }> {
    const deleted = await this.database.customerFavorite.deleteMany({
      where: { customerId, itemType, itemSlug },
    });
    return { removed: deleted.count > 0 };
  }

  private async hydrateOne(
    itemType: FavoriteItemType,
    itemSlug: string,
    createdAt: Date,
  ): Promise<AccountFavoriteDto[]> {
    if (itemType === 'PRODUCT') {
      const product = await this.database.product.findUnique({
        where: { slug: itemSlug },
        select: { titleFa: true, brand: true, brandRef: { select: { slug: true } } },
      });
      if (!product) return [];
      return [
        {
          itemType: 'PRODUCT',
          itemSlug,
          titleFa: product.titleFa,
          href: `/gift-cards/${itemSlug}`,
          brand: product.brand,
          brandSlug: product.brandRef?.slug ?? null,
          category: null,
          createdAt: createdAt.toISOString(),
        },
      ];
    }
    const service = await this.database.internationalService.findUnique({
      where: { slug: itemSlug },
      select: { nameFa: true, category: true },
    });
    if (!service) return [];
    return [
      {
        itemType: 'SERVICE',
        itemSlug,
        titleFa: service.nameFa,
        href: `/services/${itemSlug}`,
        brand: null,
        brandSlug: null,
        category: service.category,
        createdAt: createdAt.toISOString(),
      },
    ];
  }
}
