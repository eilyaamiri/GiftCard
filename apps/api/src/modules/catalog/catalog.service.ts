/* eslint-disable @typescript-eslint/consistent-type-imports -- AppConfigService is
 * constructor-injected; emitDecoratorMetadata needs the runtime class value. */
import { Inject, Injectable } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Decimal from 'decimal.js';
import { Prisma } from '@barat/database';
import { QUOTABLE_COST_CURRENCIES } from '@barat/contracts';
import type {
  DecimalString,
  GetTopUpGameResponse,
  InternationalServiceDto,
  ListProductsRequest,
  ListServicesResponse,
  ListTopUpGamesResponse,
  ServiceFieldDefinitionDto,
  SkuDto,
} from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AppConfigService } from '../../common/config/app-config.service';
import { selectBestOffer, type SelectableOffer } from '../quotes/supplier-offer-selection';
import { CATALOG_DATABASE, type CatalogDatabase } from './catalog.tokens';
import type {
  CatalogProductDto,
  GetCatalogProductResponse,
  ListBrandsResponse,
  ListCatalogProductsResponse,
  ListCategoriesResponse,
} from './catalog-taxonomy.dto';
import {
  assignCategorySchema,
  bulkSetProductActiveSchema,
  createBrandSchema,
  createCategorySchema,
  createInternationalServiceSchema,
  createProductSchema,
  createServiceFieldSchema,
  createSkuSchema,
  createSupplierOfferSchema,
  createSupplierSchema,
  mergeBrandsSchema,
  updateBrandSchema,
  updateCategorySchema,
  updateInternationalServiceSchema,
  updateProductSchema,
  updateServiceFieldSchema,
  updateSkuSchema,
  updateSupplierOfferSchema,
  updateSupplierSchema,
  type AdminBrandListInput,
  type AdminCatalogListInput,
  type AdminProductListInput,
  type AdminSkuListInput,
  type AdminSupplierOfferListInput,
  type AssignCategoryInput,
  type BulkSetProductActiveInput,
  type CreateBrandInput,
  type CreateCategoryInput,
  type CreateInternationalServiceInput,
  type CreateProductInput,
  type CreateServiceFieldInput,
  type CreateSkuInput,
  type CreateSupplierInput,
  type CreateSupplierOfferInput,
  type MergeBrandsInput,
  type UpdateBrandInput,
  type UpdateCategoryInput,
  type UpdateInternationalServiceInput,
  type UpdateProductInput,
  type UpdateServiceFieldInput,
  type UpdateSkuInput,
  type UpdateSupplierInput,
  type UpdateSupplierOfferInput,
} from './catalog.schemas';

/* ============================================================================
 * Public projections
 *
 * These `select` objects are the enforcement point for the rule that a public
 * catalog response never carries supplier identity or supplier cost. Nothing
 * from `Supplier` or `SupplierOffer` appears here, so a future careless
 * `include` cannot leak a cost through a DTO that simply has no field for it.
 * ==========================================================================*/

/**
 * "This SKU can actually be bought right now."
 *
 * Availability is not just "some supplier has stock": the offer must also be
 * priced in a currency the quote engine has an FX pair for. Without the
 * currency clause the storefront happily offers a GBP card, the quote is
 * refused as unpriceable, and the customer lands on an error page after
 * pressing buy. Both public availability checks share this one object so the
 * listing filter and the per-SKU flag can never disagree.
 */
const PURCHASABLE_OFFER: Prisma.SupplierOfferWhereInput = {
  isActive: true,
  availability: 'AVAILABLE',
  supplier: { isActive: true },
  costCurrency: { in: [...QUOTABLE_COST_CURRENCIES] },
};

/**
 * "A customer can see this product in the catalog."
 *
 * Not the same as "can buy it": a product with incomplete data is listed with
 * its buy button disabled, and it still counts towards its category and brand,
 * because it is still something the customer finds there.
 */
const VISIBLE_PRODUCT = { isActive: true } satisfies Prisma.ProductWhereInput;

/**
 * Products that belong to a category, primary or secondary.
 *
 * A Steam card lives under «بازی و گیم» and also turns up under «نرم‌افزار»;
 * browsing the second must find it, or a secondary category is decoration.
 */
function categoryMembership(slug: string): Prisma.ProductWhereInput {
  return {
    OR: [{ categoryRef: { slug } }, { extraCategories: { some: { category: { slug } } } }],
  };
}

/** Filters the frozen `ListProductsRequest` has no field for. */
export interface CatalogTaxonomyFilters {
  readonly categorySlug?: string | undefined;
  readonly brandSlug?: string | undefined;
  /**
   * Restrict every public list to these brands.
   *
   * The storefront only shelves brands it has cover art for, and sends the set
   * it is willing to show. It is a caller's scope, not a property of the data:
   * the catalog still holds every brand, an admin still sees all of them, and
   * omitting the parameter still returns everything. Applied to the counts as
   * well as the rows, so a category tile that says 48 opens on 48 products.
   */
  readonly brandSlugs?: readonly string[] | undefined;
}

/** `VISIBLE_PRODUCT`, narrowed to the brands a caller asked to be scoped to. */
function visibleProduct(brandSlugs?: readonly string[]): Prisma.ProductWhereInput {
  return brandSlugs
    ? { ...VISIBLE_PRODUCT, brandRef: { slug: { in: [...brandSlugs] } } }
    : VISIBLE_PRODUCT;
}

const PRODUCT_PUBLIC_SELECT = {
  id: true,
  slug: true,
  brand: true,
  title: true,
  titleFa: true,
  description: true,
  descriptionFa: true,
  category: true,
  imageUrl: true,
  isActive: true,
  needsReview: true,
  isQuickPick: true,
  sortOrder: true,
  createdAt: true,
  brandRef: { select: { slug: true, nameFa: true } },
  categoryRef: { select: { slug: true, nameFa: true, iconKey: true } },
} satisfies Prisma.ProductSelect;

const SKU_PUBLIC_SELECT = {
  id: true,
  productId: true,
  code: true,
  region: true,
  currency: true,
  faceValue: true,
  denominationLabel: true,
  deliveryAssetType: true,
  isActive: true,
  minQuantity: true,
  maxQuantity: true,
} satisfies Prisma.SkuSelect;

const SERVICE_FIELD_PUBLIC_SELECT = {
  id: true,
  key: true,
  label: true,
  labelFa: true,
  fieldType: true,
  isRequired: true,
  validationRegex: true,
  helpTextFa: true,
  options: true,
  sortOrder: true,
} satisfies Prisma.ServiceFieldDefinitionSelect;

const SERVICE_PUBLIC_SELECT = {
  id: true,
  slug: true,
  name: true,
  nameFa: true,
  category: true,
  descriptionFa: true,
  currency: true,
  minAmount: true,
  maxAmount: true,
  isActive: true,
  requiresManualReview: true,
  fields: { orderBy: { sortOrder: 'asc' }, select: SERVICE_FIELD_PUBLIC_SELECT },
} satisfies Prisma.InternationalServiceSelect;

/** A SKU plus the offer the quote engine should price against. */
export interface SkuQuoteTarget {
  readonly sku: Prisma.SkuGetPayload<Record<string, never>>;
  readonly offerId: string;
  readonly supplierId: string;
  readonly costCurrency: string;
  /** Listed supplier cost before discount, captured for the audit snapshot. */
  readonly listedCost: string;
  /** Supplier discount in integer basis points. */
  readonly discountBps: number;
  /** Effective supplier cost per unit, after the supplier discount. */
  readonly effectiveCost: string;
}

/**
 * A top-up offer plus everything the automated purchase will need.
 *
 * Deliberately carries the account-field definitions alongside the price. The
 * quote path has to validate what the customer typed against the venue's own
 * keys *before* it takes their money, and fetching the fields in a second call
 * would let the two answers disagree — a quote priced for `player_id` while the
 * game's fields have since changed is a purchase that cannot be credited.
 */
export interface TopUpQuoteTarget {
  readonly offer: Prisma.TopUpOfferGetPayload<Record<string, never>>;
  readonly game: Prisma.TopUpGameGetPayload<Record<string, never>>;
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly costCurrency: string;
  /** Decimal string, as stored. Never a JS number — AGENTS.md rule 1. */
  readonly costAmount: string;
  /** Provider-facing offer key, composed from the supplier's catalog identity. */
  readonly providerSku: string;
  readonly fields: readonly Prisma.TopUpFieldGetPayload<Record<string, never>>[];
}

type DecimalLike = { toFixed(decimalPlaces?: number): string };

const IMAGE_VARIANTS = [
  { extension: 'jpg', contentType: 'image/jpeg' },
  { extension: 'png', contentType: 'image/png' },
  { extension: 'webp', contentType: 'image/webp' },
  { extension: 'gif', contentType: 'image/gif' },
] as const;

function imagePath(root: string, key: string, extension: string): string {
  return path.join(root, `${key}.${extension}`);
}

/** Brand logos share the product image directory, so their keys must not
 * collide with a product id. */
function brandImageKey(brandId: string): string {
  return `brand-${brandId}`;
}

function imageExtension(file: { mimetype: string; buffer: Buffer }): (typeof IMAGE_VARIANTS)[number]['extension'] | null {
  const signatures: Record<string, readonly number[]> = {
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/png': [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'image/gif': [0x47, 0x49, 0x46, 0x38],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
  };
  const signature = signatures[file.mimetype];
  if (!signature || signature.some((byte, index) => file.buffer[index] !== byte)) return null;
  if (file.mimetype === 'image/webp' && file.buffer.toString('ascii', 8, 12) !== 'WEBP') return null;
  return IMAGE_VARIANTS.find((variant) => variant.contentType === file.mimetype)?.extension ?? null;
}

@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_DATABASE) private readonly db: CatalogDatabase,
    private readonly config: AppConfigService,
  ) {}

  /* ------------------------------------------------------------------ public */

  async listProducts(
    input: ListProductsRequest & CatalogTaxonomyFilters,
  ): Promise<ListCatalogProductsResponse> {
    const { page, pageSize } = input;
    /* Split in two: the availability half is also what the region facet is
     * counted over, and the facet must not be narrowed by the region the
     * customer already picked. */
    const sellableSku: Prisma.SkuWhereInput = {
      isActive: true,
      ...(input.onlyAvailable ? { supplierOffers: { some: PURCHASABLE_OFFER } } : {}),
    };
    const skuFilter: Prisma.SkuWhereInput = {
      ...sellableSku,
      ...(input.region ? { region: input.region } : {}),
    };

    /* Composed as an AND list rather than one object literal: search and the
     * category filter both need an OR of their own, and a second `OR:` key
     * would silently overwrite the first. */
    const conditions: Prisma.ProductWhereInput[] = [];
    if (input.category) conditions.push({ category: input.category });
    if (input.brand) conditions.push({ brand: input.brand });
    if (input.categorySlug) conditions.push(categoryMembership(input.categorySlug));
    if (input.brandSlug) conditions.push({ brandRef: { slug: input.brandSlug } });
    /* AND-ed with the customer's own brand filter rather than replacing it, so
     * a brand outside the caller's scope stays out even when asked for by
     * name — the URL is not a way around the shelf. */
    if (input.brandSlugs) conditions.push({ brandRef: { slug: { in: [...input.brandSlugs] } } });
    if (input.search) {
      conditions.push({
        OR: [
          { title: { contains: input.search, mode: 'insensitive' } },
          { titleFa: { contains: input.search } },
          { brand: { contains: input.search, mode: 'insensitive' } },
          /* The brand's Persian name is not on the product row, so a search for
           * «نتفلیکس» only works if the relation is searched too. */
          { brandRef: { nameFa: { contains: input.search } } },
        ],
      });
    }
    /* Everything except the region, so the facet keeps offering the regions the
     * customer could switch to. */
    const facetConditions = [...conditions];
    if (input.onlyAvailable) facetConditions.push({ skus: { some: sellableSku } });
    if (input.region || input.onlyAvailable) conditions.push({ skus: { some: skuFilter } });

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };

    const [rows, total, regions] = await this.db.$transaction([
      this.db.product.findMany({
        where,
        select: {
          ...PRODUCT_PUBLIC_SELECT,
          skus: { where: { isActive: true }, select: { region: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.product.count({ where }),
      this.db.sku.findMany({
        where: {
          ...sellableSku,
          product: {
            isActive: true,
            ...(facetConditions.length > 0 ? { AND: facetConditions } : {}),
          },
        },
        select: { region: true },
        distinct: ['region'],
        orderBy: { region: 'asc' },
      }),
    ]);

    return {
      items: rows.map((row) => this.toProductDto(row, row.skus)),
      regions: regions.map((sku) => sku.region),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /**
   * The categories worth showing, with a real count each.
   *
   * A category with nothing in it is left out entirely (§2): an empty tile on
   * the catalog page is a dead end, and the counts come from the same
   * membership rule the product filter uses, so a tile that says 48 opens on 48
   * products.
   */
  async listCategories(brandSlugs?: readonly string[]): Promise<ListCategoriesResponse> {
    const visible = visibleProduct(brandSlugs);
    const rows = await this.db.category.findMany({
      where: { isActive: true },
      select: {
        id: true,
        slug: true,
        name: true,
        nameFa: true,
        iconKey: true,
        descriptionFa: true,
        parentId: true,
        sortOrder: true,
        _count: {
          select: {
            products: { where: visible },
            productTags: { where: { product: visible } },
          },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { nameFa: 'asc' }],
    });

    return {
      items: rows
        .map(({ _count, ...category }) => ({
          ...category,
          /* Summed, not deduplicated: a product may not carry the same category
           * as both its primary and a secondary one. The admin write path
           * rejects that, which is what keeps this addition exact. */
          productCount: _count.products + _count.productTags,
        }))
        .filter((category) => category.productCount > 0),
    };
  }

  /**
   * Every brand that has something to sell.
   *
   * Returned whole rather than paginated — the list is bounded by the catalog,
   * and both the "popular" strip and the A–Z list on the brands page are views
   * of the same data. `isPopular` is a flag an operator sets; there are no
   * sales figures here to rank by, and inventing some would be worse than the
   * curated order.
   */
  async listBrands(brandSlugs?: readonly string[]): Promise<ListBrandsResponse> {
    const rows = await this.db.brand.findMany({
      where: { isActive: true, ...(brandSlugs ? { slug: { in: [...brandSlugs] } } : {}) },
      select: {
        id: true,
        slug: true,
        name: true,
        nameFa: true,
        logoUrl: true,
        descriptionFa: true,
        isPopular: true,
        sortOrder: true,
        _count: { select: { products: { where: VISIBLE_PRODUCT } } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return {
      items: rows
        .map(({ _count, ...brand }) => ({ ...brand, productCount: _count.products }))
        .filter((brand) => brand.productCount > 0),
    };
  }

  async getProduct(slug: string, region?: string): Promise<GetCatalogProductResponse> {
    const product = await this.db.product.findFirst({
      where: { slug, isActive: true },
      select: {
        ...PRODUCT_PUBLIC_SELECT,
        redemptionNotesFa: true,
        skus: {
          where: { isActive: true },
          select: SKU_PUBLIC_SELECT,
          orderBy: [{ region: 'asc' }, { faceValue: 'asc' }],
        },
      },
    });
    if (!product) {
      throw DomainErrors.notFound('product');
    }

    /* Regions come from every active SKU so the region picker still lists the
     * alternatives even when the caller filtered down to one of them. */
    const regions = product.skus.map((sku) => ({ region: sku.region }));
    const visibleSkus = region ? product.skus.filter((sku) => sku.region === region) : product.skus;
    /* Incomplete data: the page still opens — nothing is hidden for it — but no
     * denomination is offered, matching what `getSkuQuoteTarget` will do. */
    const availableSkuIds: ReadonlySet<string> = product.needsReview
      ? new Set<string>()
      : await this.availableSkuIds(visibleSkus.map((sku) => sku.id));

    return {
      product: {
        ...this.toProductDto(product, regions),
        redemptionNotesFa: product.redemptionNotesFa,
        skus: visibleSkus.map((sku) => this.toSkuDto(sku, availableSkuIds.has(sku.id))),
      },
    };
  }

  async listServices(
    page = 1,
    pageSize = 20,
    search?: string,
    category?: string,
  ): Promise<ListServicesResponse> {
    const where: Prisma.InternationalServiceWhereInput = {
      isActive: true,
      ...(category ? { category } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { nameFa: { contains: search } },
            ],
          }
        : {}),
    };
    const [rows, total] = await this.db.$transaction([
      this.db.internationalService.findMany({
        where,
        select: SERVICE_PUBLIC_SELECT,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.internationalService.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toServiceDto(row)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  /* ------------------------------------------------------ top-up storefront */

  /**
   * The games a customer can currently top up.
   *
   * Three conditions, and each one is load-bearing:
   *
   *   - the game is `isActive` — an operator has curated it. A newly synced
   *     game arrives inactive precisely so nothing goes on sale unreviewed.
   *   - the game is `isListed` — the venue still offers it.
   *   - the supplier is active. An inactive supplier has no adapter wired, so
   *     listing its games would advertise something that cannot be bought and
   *     would fail at quote time instead of here.
   *
   * The offer count and the «from» price are computed from the SAME predicate
   * the detail page uses, so the two can never disagree about what is on sale.
   *
   * No cost, no supplier id and no provider SKU reaches this DTO: those are
   * commercial data and, for a top-up, they would also reveal which venue we
   * buy from.
   */
  async listTopUpGames(input: {
    readonly search?: string | undefined;
  } = {}): Promise<ListTopUpGamesResponse> {
    const visible = topUpOfferVisible;
    const games = await this.db.topUpGame.findMany({
      where: {
        isActive: true,
        isListed: true,
        supplier: { isActive: true },
        ...(input.search === undefined || input.search === ''
          ? {}
          : {
              OR: [
                { name: { contains: input.search, mode: 'insensitive' } },
                { nameFa: { contains: input.search } },
              ],
            }),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        nameFa: true,
        brandName: true,
        region: true,
        imageUrl: true,
        sortOrder: true,
        offers: { where: visible, select: { costAmount: true, costCurrency: true } },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return {
      items: games.map((game) => {
        const cheapest = cheapestOffer(game.offers);
        return {
          id: game.id,
          slug: game.slug,
          name: game.name,
          nameFa: game.nameFa,
          brandName: game.brandName,
          region: game.region,
          imageUrl: game.imageUrl,
          fromCostAmount: cheapest?.costAmount ?? null,
          fromCostCurrency: cheapest?.costCurrency ?? null,
          offerCount: game.offers.length,
        };
      }),
    };
  }

  /**
   * One game and everything about it a customer needs.
   *
   * Refused by the same four conditions the catalogue uses, and additionally
   * for `requiresCredentials`: a game that wants a login is never sellable in
   * this phase. The refusal is a 404 rather than a 403 — the customer is told
   * the page does not exist, not that a password-gated game does.
   */
  async getTopUpGame(slug: string): Promise<GetTopUpGameResponse> {
    const game = await this.db.topUpGame.findFirst({
      where: {
        slug,
        isActive: true,
        isListed: true,
        requiresCredentials: false,
        supplier: { isActive: true },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        nameFa: true,
        brandName: true,
        region: true,
        imageUrl: true,
        providerNote: true,
        descriptionFa: true,
        offers: {
          where: topUpOfferVisible,
          select: {
            id: true,
            name: true,
            nameFa: true,
            costAmount: true,
            costCurrency: true,
            sortOrder: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
        fields: {
          select: {
            key: true,
            label: true,
            labelFa: true,
            fieldType: true,
            isRequired: true,
            options: true,
            validationRegex: true,
            helpTextFa: true,
            sortOrder: true,
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    if (game === null) {
      throw DomainErrors.notFound('top-up game');
    }

    const cheapest = cheapestOffer(game.offers);
    return {
      game: {
        id: game.id,
        slug: game.slug,
        name: game.name,
        nameFa: game.nameFa,
        brandName: game.brandName,
        region: game.region,
        imageUrl: game.imageUrl,
        fromCostAmount: cheapest?.costAmount ?? null,
        fromCostCurrency: cheapest?.costCurrency ?? null,
        offerCount: game.offers.length,
        providerNote: game.providerNote,
        descriptionFa: game.descriptionFa,
        fields: game.fields.map((field) => ({
          ...field,
          options: readTopUpFieldOptions(field.options),
        })),
        /*
         * No `indicativePriceIrr` here, deliberately. A display price would have
         * to be computed from a live FX rate and a live rule, and the moment it
         * sits in a list response it starts to look payable. The customer sees
         * the offer and asks for a real quote; the quote endpoint is the only
         * thing that produces a number anyone can pay.
         */
        offers: game.offers.map((offer) => ({
          id: offer.id,
          name: offer.name,
          nameFa: offer.nameFa,
          /*
           * Always true, because the query already filtered on it. The field
           * exists so the shelf has somewhere to put «ناموجود» later without a
           * contract change — and saying `true` here rather than omitting it
           * keeps the storefront from having to guess.
           */
          isAvailable: true,
          sortOrder: offer.sortOrder,
        })),
      },
    };
  }

  /* -------------------------------------------------------- quote-facing API */

  /**
   * Resolve the SKU and the supplier offer a quote should be priced against.
   *
   * This is the ONLY place supplier data crosses into the quote flow, and the
   * returned identity/cost is for internal pricing and the operator's purchase
   * task — it is never projected into a customer-facing DTO.
   */
  async getSkuQuoteTarget(skuId: string, currency: string): Promise<SkuQuoteTarget> {
    /* `needsReview` is not cosmetic. A product whose data is incomplete is
     * listed with its buy button disabled, and this is the half of that which a
     * customer cannot get around: a hand-made POST with the SKU id finds
     * nothing here either. The storefront decides what to grey out; the price
     * is refused server-side. */
    const sku = await this.db.sku.findFirst({
      where: { id: skuId, isActive: true, product: { isActive: true, needsReview: false } },
      include: { supplierOffers: { include: { supplier: { select: { isActive: true } } } } },
    });
    if (!sku) {
      throw DomainErrors.notFound('sku');
    }

    const selection = selectBestOffer(sku.supplierOffers.map(toSelectableOffer), currency);
    if (!selection) {
      /* The message deliberately says nothing about suppliers: "which supplier
       * is out of stock" is commercially sensitive and would be visible to any
       * customer who requested a quote. */
      throw DomainErrors.conflict(
        'این محصول در حال حاضر موجود نیست.',
        `no available supplier offer for sku ${skuId} in ${currency}`,
      );
    }

    const { supplierOffers: _offers, ...bare } = sku;
    return {
      sku: bare,
      offerId: selection.offer.id,
      supplierId: selection.offer.supplierId,
      costCurrency: selection.offer.costCurrency,
      listedCost: selection.offer.costAmount,
      discountBps: selection.offer.discountBps,
      effectiveCost: selection.effectiveCost,
    };
  }

  async getServiceForQuote(serviceId: string) {
    const service = await this.db.internationalService.findFirst({
      where: { id: serviceId, isActive: true },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!service) {
      throw DomainErrors.notFound('service');
    }
    return service;
  }

  /**
   * Resolve a direct top-up offer to everything a quote needs to price it.
   *
   * Four rows have to agree before a customer may be charged, and all four are
   * checked in one query rather than by trusting the request:
   *
   *   - the offer is active AND still listed by the venue. `isListed` is set by
   *     sync; an offer the venue has withdrawn is not sellable even if an
   *     operator has not got round to deactivating it, because the purchase
   *     would simply fail.
   *   - the game is active and listed. This is what makes an operator's curation
   *     stick: a top-up game is synced inactive and stays unbuyable until
   *     somebody deliberately switches it on.
   *   - the game does not require credentials. Phase 1 sells only games that
   *     take a public identifier. Refusing here — rather than at purchase time —
   *     is the difference between a customer seeing "unavailable" and a customer
   *     typing their game password into a form we would then have to store.
   *   - the supplier is active, since an inactive one has no adapter wired.
   */
  async getTopUpOfferForQuote(offerId: string): Promise<TopUpQuoteTarget> {
    const offer = await this.db.topUpOffer.findFirst({
      where: {
        id: offerId,
        isActive: true,
        isListed: true,
        game: { isActive: true, isListed: true },
      },
      include: {
        game: {
          include: {
            fields: { orderBy: { sortOrder: 'asc' } },
            supplier: { select: { id: true, code: true, isActive: true } },
          },
        },
      },
    });
    if (!offer) {
      throw DomainErrors.notFound('top-up offer');
    }

    const { game } = offer;
    if (game.requiresCredentials) {
      /* Same message as an unavailable product, on purpose: telling a caller
       * "this game needs a login" only invites them to try to supply one. */
      throw DomainErrors.conflict(
        'این محصول در حال حاضر موجود نیست.',
        `top-up game ${game.slug} requires credentials and is not sellable`,
      );
    }
    if (!game.supplier.isActive) {
      throw DomainErrors.conflict(
        'این محصول در حال حاضر موجود نیست.',
        `top-up supplier ${game.supplier.code} is inactive`,
      );
    }

    return {
      offer,
      game,
      supplierId: game.supplier.id,
      supplierCode: game.supplier.code,
      costCurrency: offer.costCurrency,
      costAmount: offer.costAmount.toFixed(6),
      providerSku: topUpProviderSku(
        game.supplier.code,
        game.providerCategoryId,
        offer.providerOfferId,
      ),
      fields: game.fields,
    };
  }

  /* ---------------------------------------------------------------- admin */

  /**
   * Search covers the product's name and its id, which is what an operator has
   * in hand: either the title on the card or the identifier from a supplier
   * catalog export. `id` is matched with `contains` rather than an equality
   * check so that the supplier's own product number finds the row — typing
   * `14971` reaches `rlx_p_14971` without anyone having to know the prefix.
   *
   * The term is deliberately NOT matched against brand or category: those
   * return hundreds of rows each and would bury the product being looked for.
   */
  async adminListProducts(query: AdminProductListInput) {
    const status = query.status ?? (query.includeInactive ? 'ALL' : 'ACTIVE');
    const where: Prisma.ProductWhereInput = {
      ...(status === 'ACTIVE' ? { isActive: true } : {}),
      ...(status === 'INACTIVE' ? { isActive: false } : {}),
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.brandId ? { brandId: query.brandId } : {}),
      ...(query.needsReview === undefined ? {} : { needsReview: query.needsReview }),
      ...(query.search
        ? {
            OR: [
              { id: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
              { titleFa: { contains: query.search } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.product.findMany({
        where,
        include: {
          _count: { select: { skus: true } },
          brandRef: { select: { id: true, slug: true, name: true, nameFa: true } },
          categoryRef: { select: { id: true, slug: true, nameFa: true, iconKey: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.product.count({ where }),
    ]);
    return { items, meta: pageMeta(query.page, query.pageSize, total) };
  }

  async adminGetProduct(id: string) {
    const product = await this.db.product.findUnique({
      where: { id },
      include: {
        brandRef: { select: { id: true, slug: true, name: true, nameFa: true } },
        categoryRef: { select: { id: true, slug: true, nameFa: true, iconKey: true } },
        extraCategories: {
          select: { category: { select: { id: true, slug: true, nameFa: true } } },
        },
        skus: {
          include: {
            supplierOffers: {
              include: { supplier: true },
              orderBy: [{ priority: 'asc' }, { costAmount: 'asc' }],
            },
          },
          orderBy: [{ region: 'asc' }, { faceValue: 'asc' }],
        },
      },
    });
    if (!product) throw DomainErrors.notFound('product');
    return product;
  }

  async adminArchiveProduct(id: string) {
    await this.assertExists(this.db.product.count({ where: { id } }), 'product');
    return this.db.product.update({ where: { id }, data: { isActive: false } });
  }

  /** Activate or deactivate a batch of products in one pass. */
  async adminBulkSetProductActive(input: BulkSetProductActiveInput) {
    const { productIds, isActive } = bulkSetProductActiveSchema.parse(input);
    const ids = [...new Set(productIds)];
    const { count } = await this.db.product.updateMany({ where: { id: { in: ids } }, data: { isActive } });
    return { requested: ids.length, updated: count };
  }

  async adminListSkus(query: AdminSkuListInput) {
    const where: Prisma.SkuWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.productId ? { productId: query.productId } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.sku.findMany({
        where,
        include: { product: true, _count: { select: { supplierOffers: true } } },
        orderBy: [{ createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.sku.count({ where }),
    ]);
    return { items, meta: pageMeta(query.page, query.pageSize, total) };
  }

  async adminGetSku(id: string) {
    const sku = await this.db.sku.findUnique({
      where: { id },
      include: {
        product: true,
        supplierOffers: {
          include: { supplier: true },
          orderBy: [{ priority: 'asc' }, { costAmount: 'asc' }],
        },
      },
    });
    if (!sku) throw DomainErrors.notFound('sku');
    return sku;
  }

  async adminArchiveSku(id: string) {
    await this.assertExists(this.db.sku.count({ where: { id } }), 'sku');
    return this.db.sku.update({ where: { id }, data: { isActive: false } });
  }

  async adminListSuppliers(query: AdminCatalogListInput) {
    const where: Prisma.SupplierWhereInput = query.includeInactive ? {} : { isActive: true };
    const [items, total] = await this.db.$transaction([
      this.db.supplier.findMany({
        where,
        include: { _count: { select: { offers: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.supplier.count({ where }),
    ]);
    return { items, meta: pageMeta(query.page, query.pageSize, total) };
  }

  async adminGetSupplier(id: string) {
    const supplier = await this.db.supplier.findUnique({
      where: { id },
      include: {
        offers: {
          include: { sku: { include: { product: true } } },
          orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        },
      },
    });
    if (!supplier) throw DomainErrors.notFound('supplier');
    return supplier;
  }

  async adminArchiveSupplier(id: string) {
    await this.assertExists(this.db.supplier.count({ where: { id } }), 'supplier');
    return this.db.supplier.update({ where: { id }, data: { isActive: false } });
  }

  async adminListOffers(query: AdminSupplierOfferListInput) {
    const where: Prisma.SupplierOfferWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.skuId ? { skuId: query.skuId } : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.supplierOffer.findMany({
        where,
        include: { supplier: true, sku: { include: { product: true } } },
        orderBy: [{ priority: 'asc' }, { costAmount: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.supplierOffer.count({ where }),
    ]);
    return { items, meta: pageMeta(query.page, query.pageSize, total) };
  }

  async adminGetOffer(id: string) {
    const offer = await this.db.supplierOffer.findUnique({
      where: { id },
      include: { supplier: true, sku: { include: { product: true } } },
    });
    if (!offer) throw DomainErrors.notFound('supplier offer');
    return offer;
  }

  async adminArchiveOffer(id: string) {
    await this.assertExists(this.db.supplierOffer.count({ where: { id } }), 'supplier offer');
    return this.db.supplierOffer.update({ where: { id }, data: { isActive: false } });
  }

  async adminListServices(query: AdminCatalogListInput) {
    const where: Prisma.InternationalServiceWhereInput = query.includeInactive
      ? {}
      : { isActive: true };
    const [items, total] = await this.db.$transaction([
      this.db.internationalService.findMany({
        where,
        include: { fields: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.internationalService.count({ where }),
    ]);
    return { items, meta: pageMeta(query.page, query.pageSize, total) };
  }

  async adminGetService(id: string) {
    const service = await this.db.internationalService.findUnique({
      where: { id },
      include: { fields: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!service) throw DomainErrors.notFound('service');
    return service;
  }

  async adminArchiveService(id: string) {
    await this.assertExists(this.db.internationalService.count({ where: { id } }), 'service');
    return this.db.internationalService.update({ where: { id }, data: { isActive: false } });
  }

  async adminListFields(serviceId: string) {
    await this.assertExists(
      this.db.internationalService.count({ where: { id: serviceId } }),
      'service',
    );
    return this.db.serviceFieldDefinition.findMany({
      where: { serviceId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async adminGetField(id: string) {
    const field = await this.db.serviceFieldDefinition.findUnique({ where: { id } });
    if (!field) throw DomainErrors.notFound('service field');
    return field;
  }

  async adminDeleteField(id: string) {
    await this.assertExists(
      this.db.serviceFieldDefinition.count({ where: { id } }),
      'service field',
    );
    return this.db.serviceFieldDefinition.delete({ where: { id } });
  }

  async adminCreateProduct(input: CreateProductInput) {
    const { extraCategoryIds, brand, category, ...data } = createProductSchema.parse(input);
    const taxonomy = await this.resolveTaxonomy(data.brandId, data.categoryId, extraCategoryIds);

    return this.db.product.create({
      data: {
        ...data,
        /* The supplier columns are NOT NULL and a hand-made product has no
         * supplier. Falling back to the chosen brand and category keeps them
         * meaningful instead of filled with a placeholder. */
        brand: brand ?? taxonomy.brandName,
        category: category ?? taxonomy.categoryName,
        ...(extraCategoryIds.length > 0
          ? { extraCategories: { create: extraCategoryIds.map((categoryId) => ({ categoryId })) } }
          : {}),
      },
    });
  }

  async adminUpdateProduct(id: string, input: UpdateProductInput) {
    const { extraCategoryIds, ...data } = updateProductSchema.parse(input);
    const current = await this.db.product.findUnique({
      where: { id },
      select: { brandId: true, categoryId: true },
    });
    if (!current) throw DomainErrors.notFound('product');

    /* Validated against what the product will be after this patch, not what was
     * sent: a patch that only changes the primary category still has to agree
     * with the secondary ones already on the row. */
    await this.resolveTaxonomy(
      data.brandId ?? current.brandId,
      data.categoryId ?? current.categoryId,
      extraCategoryIds,
    );

    return this.db.product.update({
      where: { id },
      data: {
        ...data,
        ...(extraCategoryIds === undefined
          ? {}
          : {
              /* Replaced wholesale rather than merged: the form sends the set
               * the operator sees, so an unticked box has to remove a row. */
              extraCategories: {
                deleteMany: {},
                create: extraCategoryIds.map((categoryId) => ({ categoryId })),
              },
            }),
      },
    });
  }

  /* --------------------------------------------------- admin: taxonomy */

  /**
   * Checks a product's brand and categories before anything is written.
   *
   * The two things worth refusing: a category that is also listed as a
   * secondary one — `listCategories` adds the primary and secondary counts, and
   * that sum is only exact while no product holds the same category twice — and
   * an id that does not exist, which the database would report as an opaque
   * foreign-key violation.
   */
  private async resolveTaxonomy(
    brandId: string | null | undefined,
    categoryId: string | null | undefined,
    extraCategoryIds: readonly string[] | undefined,
  ): Promise<{ brandName: string; categoryName: string }> {
    const extras = extraCategoryIds ?? [];
    if (categoryId && extras.includes(categoryId)) {
      throw DomainErrors.validation([
        {
          path: 'extraCategoryIds',
          message: 'دستهٔ اصلی نمی‌تواند هم‌زمان به‌عنوان دستهٔ مرتبط انتخاب شود.',
        },
      ]);
    }
    if (new Set(extras).size !== extras.length) {
      throw DomainErrors.validation([
        { path: 'extraCategoryIds', message: 'یک دسته نمی‌تواند دو بار انتخاب شود.' },
      ]);
    }

    const wanted = [...new Set(categoryId ? [categoryId, ...extras] : extras)];
    const [brand, categories] = await Promise.all([
      brandId ? this.db.brand.findUnique({ where: { id: brandId }, select: { name: true } }) : null,
      wanted.length > 0
        ? this.db.category.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } })
        : [],
    ]);

    if (brandId && !brand) throw DomainErrors.notFound('brand');
    if (categories.length !== wanted.length) throw DomainErrors.notFound('category');

    return {
      brandName: brand?.name ?? 'Unknown',
      categoryName: categories.find((row) => row.id === categoryId)?.name ?? 'Other',
    };
  }

  /**
   * Every category, empty ones included — the opposite of the public list.
   *
   * An operator needs to see a category precisely when nothing is in it yet,
   * and the two counts tell them whether it is missing products or missing an
   * activation.
   */
  async adminListCategories() {
    /* Two passes over the same table: Prisma counts one relation once per
     * query, so the unfiltered total and the active-only count cannot share a
     * `_count` select. Both run in one transaction, so a product activated
     * mid-read cannot make the active count exceed the total. */
    const [rows, activeRows] = await this.db.$transaction([
      this.db.category.findMany({
        include: {
          parent: { select: { id: true, nameFa: true } },
          _count: { select: { products: true, productTags: true } },
        },
        orderBy: [{ sortOrder: 'asc' }, { nameFa: 'asc' }],
      }),
      this.db.category.findMany({
        select: {
          id: true,
          _count: {
            select: {
              products: { where: VISIBLE_PRODUCT },
              productTags: { where: { product: VISIBLE_PRODUCT } },
            },
          },
        },
      }),
    ]);

    const activeCount = new Map(
      activeRows.map((row) => [row.id, row._count.products + row._count.productTags]),
    );

    return {
      items: rows.map(({ _count, ...category }) => ({
        ...category,
        productCount: _count.products + _count.productTags,
        activeProductCount: activeCount.get(category.id) ?? 0,
      })),
    };
  }

  async adminGetCategory(id: string) {
    const category = await this.db.category.findUnique({
      where: { id },
      include: {
        parent: { select: { id: true, nameFa: true } },
        _count: { select: { products: true, productTags: true } },
      },
    });
    if (!category) throw DomainErrors.notFound('category');
    return category;
  }

  async adminCreateCategory(input: CreateCategoryInput) {
    const data = createCategorySchema.parse(input);
    if (data.parentId) {
      await this.assertExists(this.db.category.count({ where: { id: data.parentId } }), 'category');
    }
    return this.db.category.create({ data });
  }

  async adminUpdateCategory(id: string, input: UpdateCategoryInput) {
    const data = updateCategorySchema.parse(input);
    await this.assertExists(this.db.category.count({ where: { id } }), 'category');
    if (data.parentId) {
      if (data.parentId === id) {
        throw DomainErrors.validation([
          { path: 'parentId', message: 'یک دسته نمی‌تواند والد خودش باشد.' },
        ]);
      }
      await this.assertExists(this.db.category.count({ where: { id: data.parentId } }), 'category');
    }
    return this.db.category.update({ where: { id }, data });
  }

  /**
   * Deactivates rather than deletes.
   *
   * Deleting would null the `categoryId` of everything in it and quietly strip
   * a few hundred products of their place in the catalog. Switched off, the
   * category disappears from the storefront and its products keep their row.
   */
  async adminArchiveCategory(id: string) {
    await this.assertExists(this.db.category.count({ where: { id } }), 'category');
    return this.db.category.update({ where: { id }, data: { isActive: false } });
  }

  /** Move a batch of products into one category. */
  async adminAssignCategory(input: AssignCategoryInput) {
    const { productIds, categoryId } = assignCategorySchema.parse(input);
    await this.assertExists(this.db.category.count({ where: { id: categoryId } }), 'category');

    const ids = [...new Set(productIds)];
    const [, moved] = await this.db.$transaction([
      /* A product cannot hold the same category as primary and secondary, so
       * the tag has to go when the category becomes the primary one. */
      this.db.productCategory.deleteMany({ where: { productId: { in: ids }, categoryId } }),
      this.db.product.updateMany({ where: { id: { in: ids } }, data: { categoryId } }),
    ]);

    return { requested: ids.length, updated: moved.count };
  }

  async adminListBrands(query: AdminBrandListInput) {
    const where: Prisma.BrandWhereInput = {
      ...(query.includeInactive ? {} : { isActive: true }),
      /* Three columns, because an operator hunting a duplicate has whichever of
       * them the feed happened to use. */
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' as const } },
              { nameFa: { contains: query.search } },
              { slug: { contains: query.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.db.$transaction([
      this.db.brand.findMany({
        where,
        include: { _count: { select: { products: true } } },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.db.brand.count({ where }),
    ]);
    return { items, meta: pageMeta(query.page, query.pageSize, total) };
  }

  /**
   * Every brand, four columns wide, for a picker.
   *
   * The paged list caps at 100 rows and there are ~330 brands, so a product
   * form that has to offer all of them cannot use it. This is the same data
   * without the counts or the timestamps — a few kilobytes rather than a page
   * of four requests.
   */
  async adminBrandOptions() {
    const items = await this.db.brand.findMany({
      select: { id: true, slug: true, name: true, nameFa: true, isActive: true },
      orderBy: [{ name: 'asc' }],
    });
    return { items };
  }

  async adminGetBrand(id: string) {
    const brand = await this.db.brand.findUnique({
      where: { id },
      include: { _count: { select: { products: true } } },
    });
    if (!brand) throw DomainErrors.notFound('brand');
    return brand;
  }

  async adminCreateBrand(input: CreateBrandInput) {
    return this.db.brand.create({ data: createBrandSchema.parse(input) });
  }

  async adminUpdateBrand(id: string, input: UpdateBrandInput) {
    const data = updateBrandSchema.parse(input);
    await this.assertExists(this.db.brand.count({ where: { id } }), 'brand');
    return this.db.brand.update({ where: { id }, data });
  }

  async adminArchiveBrand(id: string) {
    await this.assertExists(this.db.brand.count({ where: { id } }), 'brand');
    return this.db.brand.update({ where: { id }, data: { isActive: false } });
  }

  /**
   * Fold one brand into another and remove the emptied one.
   *
   * Both halves run in one transaction. Moving the products and then failing to
   * delete the source would leave a brand with no products — harmless. Deleting
   * first and failing to move would take the products' brand with it, which is
   * the kind of loss the audit was written to prevent.
   */
  async adminMergeBrands(input: MergeBrandsInput) {
    const { sourceBrandId, targetBrandId } = mergeBrandsSchema.parse(input);
    const brands = await this.db.brand.findMany({
      where: { id: { in: [sourceBrandId, targetBrandId] } },
      select: { id: true, name: true },
    });
    const target = brands.find((brand) => brand.id === targetBrandId);
    if (brands.length !== 2 || !target) throw DomainErrors.notFound('brand');

    const [moved] = await this.db.$transaction([
      this.db.product.updateMany({
        where: { brandId: sourceBrandId },
        /* The free-text column follows the relation. Left alone it would still
         * read the old spelling, and a re-import would match on it and undo
         * the merge. */
        data: { brandId: targetBrandId, brand: target.name },
      }),
      this.db.brand.delete({ where: { id: sourceBrandId } }),
    ]);

    return { movedProducts: moved.count, targetBrandId };
  }

  /** Same storage and the same refusal to accept SVG as a product image. */
  async adminUploadBrandLogo(id: string, file: { mimetype: string; buffer: Buffer }) {
    await this.assertExists(this.db.brand.count({ where: { id } }), 'brand');
    await this.storeImage(brandImageKey(id), file);
    return this.db.brand.update({
      where: { id },
      data: { logoUrl: `/api/catalog/brands/${id}/logo` },
    });
  }

  async brandLogo(id: string): Promise<{ buffer: Buffer; contentType: string }> {
    await this.assertExists(this.db.brand.count({ where: { id } }), 'brand');
    return this.readImage(brandImageKey(id), 'brand logo');
  }

  /** Store a validated raster image outside the database and expose only its
   * same-origin API URL. SVG is intentionally not accepted: it is executable
   * content when served inline, and a product image must never become an XSS
   * upload primitive. */
  async adminUploadProductImage(
    id: string,
    file: { mimetype: string; buffer: Buffer },
  ) {
    await this.assertExists(this.db.product.count({ where: { id } }), 'product');
    await this.storeImage(id, file);

    return this.db.product.update({
      where: { id },
      data: { imageUrl: `/api/catalog/products/${id}/image` },
    });
  }

  async productImage(id: string): Promise<{ buffer: Buffer; contentType: string }> {
    await this.assertExists(this.db.product.count({ where: { id } }), 'product');
    return this.readImage(id, 'product image');
  }

  /** Writes one variant and removes the others, so a re-upload cannot leave the
   * previous format behind for `readImage` to find first. */
  private async storeImage(key: string, file: { mimetype: string; buffer: Buffer }): Promise<void> {
    const extension = imageExtension(file);
    if (!extension) {
      throw DomainErrors.validation([
        { path: 'file', message: 'تصویر باید یک فایل معتبر JPG، PNG، WebP یا GIF باشد.' },
      ]);
    }

    const root = this.config.productImageDir;
    await fs.mkdir(root, { recursive: true });
    await Promise.all(
      IMAGE_VARIANTS.filter((variant) => variant.extension !== extension).map((variant) =>
        fs.rm(imagePath(root, key, variant.extension), { force: true }),
      ),
    );
    await fs.writeFile(imagePath(root, key, extension), file.buffer, { mode: 0o640 });
  }

  private async readImage(
    key: string,
    what: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    for (const variant of IMAGE_VARIANTS) {
      try {
        return {
          buffer: await fs.readFile(imagePath(this.config.productImageDir, key, variant.extension)),
          contentType: variant.contentType,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    throw DomainErrors.notFound(what);
  }

  async adminCreateSku(input: CreateSkuInput) {
    const data = createSkuSchema.parse(input);
    await this.assertExists(this.db.product.count({ where: { id: data.productId } }), 'product');
    return this.db.sku.create({ data });
  }

  async adminUpdateSku(id: string, input: UpdateSkuInput) {
    const data = updateSkuSchema.parse(input);
    const current = await this.db.sku.findUnique({ where: { id } });
    if (!current) {
      throw DomainErrors.notFound('sku');
    }
    const minQuantity = data.minQuantity ?? current.minQuantity;
    const maxQuantity = data.maxQuantity ?? current.maxQuantity;
    if (maxQuantity < minQuantity) {
      throw DomainErrors.validation([
        {
          path: 'maxQuantity',
          message: 'maxQuantity must be greater than or equal to minQuantity',
        },
      ]);
    }
    return this.db.sku.update({ where: { id }, data });
  }

  async adminCreateSupplier(input: CreateSupplierInput) {
    return this.db.supplier.create({ data: createSupplierSchema.parse(input) });
  }

  async adminUpdateSupplier(id: string, input: UpdateSupplierInput) {
    const data = updateSupplierSchema.parse(input);
    await this.assertExists(this.db.supplier.count({ where: { id } }), 'supplier');
    return this.db.supplier.update({ where: { id }, data });
  }

  async adminCreateOffer(input: CreateSupplierOfferInput) {
    const data = createSupplierOfferSchema.parse(input);
    await this.assertExists(this.db.supplier.count({ where: { id: data.supplierId } }), 'supplier');
    await this.assertExists(this.db.sku.count({ where: { id: data.skuId } }), 'sku');
    return this.db.supplierOffer.create({ data });
  }

  async adminUpdateOffer(id: string, input: UpdateSupplierOfferInput) {
    const data = updateSupplierOfferSchema.parse(input);
    await this.assertExists(this.db.supplierOffer.count({ where: { id } }), 'supplier offer');
    return this.db.supplierOffer.update({ where: { id }, data });
  }

  async adminCreateService(input: CreateInternationalServiceInput) {
    const { fields, ...service } = createInternationalServiceSchema.parse(input);
    return this.db.internationalService.create({
      data: {
        ...service,
        ...(fields.length > 0
          ? { fields: { create: fields.map((field) => this.toFieldCreateData(field)) } }
          : {}),
      },
    });
  }

  async adminUpdateService(id: string, input: UpdateInternationalServiceInput) {
    const data = updateInternationalServiceSchema.parse(input);
    const current = await this.db.internationalService.findUnique({
      where: { id },
      select: { minAmount: true, maxAmount: true },
    });
    if (!current) {
      throw DomainErrors.notFound('service');
    }

    const minAmount =
      data.minAmount === undefined ? (current.minAmount?.toString() ?? null) : data.minAmount;
    const maxAmount =
      data.maxAmount === undefined ? (current.maxAmount?.toString() ?? null) : data.maxAmount;
    if (
      minAmount !== null &&
      maxAmount !== null &&
      new Decimal(minAmount).gt(new Decimal(maxAmount))
    ) {
      throw DomainErrors.validation([
        {
          path: 'maxAmount',
          message: 'maxAmount must be greater than or equal to minAmount',
        },
      ]);
    }

    return this.db.internationalService.update({ where: { id }, data });
  }

  async adminCreateField(input: CreateServiceFieldInput) {
    const { serviceId, ...field } = createServiceFieldSchema.parse(input);
    await this.assertExists(
      this.db.internationalService.count({ where: { id: serviceId } }),
      'service',
    );
    return this.db.serviceFieldDefinition.create({
      data: { serviceId, ...this.toFieldCreateData(field) },
    });
  }

  async adminUpdateField(id: string, input: UpdateServiceFieldInput) {
    const data = updateServiceFieldSchema.parse(input);
    await this.assertExists(
      this.db.serviceFieldDefinition.count({ where: { id } }),
      'service field',
    );
    return this.db.serviceFieldDefinition.update({
      where: { id },
      data: this.toFieldUpdateData(data),
    });
  }

  /* --------------------------------------------------------------- helpers */

  /** SKU ids that currently have at least one usable supplier offer. */
  private async availableSkuIds(skuIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (skuIds.length === 0) {
      return new Set();
    }
    const rows = await this.db.supplierOffer.findMany({
      where: { skuId: { in: [...skuIds] }, ...PURCHASABLE_OFFER },
      select: { skuId: true },
      distinct: ['skuId'],
    });
    return new Set(rows.map((row) => row.skuId));
  }

  private async assertExists(countPromise: Promise<number>, what: string): Promise<void> {
    if ((await countPromise) === 0) {
      throw DomainErrors.notFound(what);
    }
  }

  private toProductDto(
    row: {
      id: string;
      slug: string;
      brand: string;
      title: string;
      titleFa: string;
      description: string | null;
      descriptionFa: string | null;
      category: string;
      imageUrl: string | null;
      isActive: boolean;
      needsReview: boolean;
      isQuickPick: boolean;
      sortOrder: number;
      createdAt: Date;
      brandRef: { slug: string; nameFa: string } | null;
      categoryRef: { slug: string; nameFa: string; iconKey: string } | null;
    },
    skuRegions: ReadonlyArray<{ region: string }>,
  ): CatalogProductDto {
    return {
      id: row.id,
      slug: row.slug,
      brand: row.brand,
      title: row.title,
      titleFa: row.titleFa,
      description: row.description,
      descriptionFa: row.descriptionFa,
      category: row.category,
      imageUrl: row.imageUrl,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
      regions: [...new Set(skuRegions.map((sku) => sku.region))].sort(),
      createdAt: row.createdAt.toISOString(),
      brandSlug: row.brandRef?.slug ?? null,
      brandNameFa: row.brandRef?.nameFa ?? null,
      categorySlug: row.categoryRef?.slug ?? null,
      categoryNameFa: row.categoryRef?.nameFa ?? null,
      categoryIconKey: row.categoryRef?.iconKey ?? null,
      needsReview: row.needsReview,
      isQuickPick: row.isQuickPick,
    };
  }

  private toSkuDto(
    row: {
      id: string;
      productId: string;
      code: string;
      region: string;
      currency: string;
      faceValue: DecimalLike;
      denominationLabel: string;
      deliveryAssetType: SkuDto['deliveryAssetType'];
      isActive: boolean;
      minQuantity: number;
      maxQuantity: number;
    },
    isAvailable: boolean,
  ): SkuDto {
    return {
      id: row.id,
      productId: row.productId,
      code: row.code,
      region: row.region,
      currency: row.currency,
      faceValue: decimalString(row.faceValue) as DecimalString,
      denominationLabel: row.denominationLabel,
      deliveryAssetType: row.deliveryAssetType,
      isActive: row.isActive,
      minQuantity: row.minQuantity,
      maxQuantity: row.maxQuantity,
      /* Indicative pricing needs a live FX read, which belongs to the quote
       * flow. A list page must never imply a payable price (rule 11). */
      indicativePriceIrr: null,
      indicativePriceToman: null,
      isAvailable,
    };
  }

  private toServiceDto(row: {
    id: string;
    slug: string;
    name: string;
    nameFa: string;
    category: string;
    descriptionFa: string | null;
    currency: string;
    minAmount: DecimalLike | null;
    maxAmount: DecimalLike | null;
    isActive: boolean;
    requiresManualReview: boolean;
    fields: ReadonlyArray<{
      id: string;
      key: string;
      label: string;
      labelFa: string;
      fieldType: ServiceFieldDefinitionDto['fieldType'];
      isRequired: boolean;
      validationRegex: string | null;
      helpTextFa: string | null;
      options: Prisma.JsonValue | null;
      sortOrder: number;
    }>;
  }): InternationalServiceDto {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      nameFa: row.nameFa,
      category: row.category,
      descriptionFa: row.descriptionFa,
      currency: row.currency,
      minAmount: row.minAmount === null ? null : (decimalString(row.minAmount) as DecimalString),
      maxAmount: row.maxAmount === null ? null : (decimalString(row.maxAmount) as DecimalString),
      isActive: row.isActive,
      requiresManualReview: row.requiresManualReview,
      fields: row.fields.map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        labelFa: field.labelFa,
        fieldType: field.fieldType,
        isRequired: field.isRequired,
        validationRegex: field.validationRegex,
        helpTextFa: field.helpTextFa,
        options: parseFieldOptions(field.options),
        sortOrder: field.sortOrder,
      })),
    };
  }

  private toFieldCreateData(field: {
    key: string;
    label: string;
    labelFa: string;
    fieldType: ServiceFieldDefinitionDto['fieldType'];
    isRequired: boolean;
    validationRegex?: string | null;
    helpTextFa?: string | null;
    options?: ReadonlyArray<{ value: string; labelFa: string }> | null;
    sortOrder: number;
  }): Omit<Prisma.ServiceFieldDefinitionCreateWithoutServiceInput, 'service'> {
    return {
      key: field.key,
      label: field.label,
      labelFa: field.labelFa,
      fieldType: field.fieldType,
      isRequired: field.isRequired,
      validationRegex: field.validationRegex ?? null,
      helpTextFa: field.helpTextFa ?? null,
      options: field.options == null ? Prisma.JsonNull : (field.options as Prisma.InputJsonValue),
      sortOrder: field.sortOrder,
    };
  }

  private toFieldUpdateData(
    field: UpdateServiceFieldInput,
  ): Prisma.ServiceFieldDefinitionUncheckedUpdateInput {
    return {
      ...(field.key === undefined ? {} : { key: field.key }),
      ...(field.label === undefined ? {} : { label: field.label }),
      ...(field.labelFa === undefined ? {} : { labelFa: field.labelFa }),
      ...(field.fieldType === undefined ? {} : { fieldType: field.fieldType }),
      ...(field.isRequired === undefined ? {} : { isRequired: field.isRequired }),
      ...(field.validationRegex === undefined ? {} : { validationRegex: field.validationRegex }),
      ...(field.helpTextFa === undefined ? {} : { helpTextFa: field.helpTextFa }),
      ...(field.options === undefined
        ? {}
        : {
            options:
              field.options === null ? Prisma.JsonNull : (field.options as Prisma.InputJsonValue),
          }),
      ...(field.sortOrder === undefined ? {} : { sortOrder: field.sortOrder }),
    };
  }
}

function toSelectableOffer(offer: {
  id: string;
  supplierId: string;
  costCurrency: string;
  costAmount: DecimalLike;
  discountBps: number;
  availability: string;
  isActive: boolean;
  priority: number;
  supplier: { isActive: boolean };
}): SelectableOffer {
  return {
    id: offer.id,
    supplierId: offer.supplierId,
    costCurrency: offer.costCurrency,
    costAmount: decimalString(offer.costAmount),
    discountBps: offer.discountBps,
    availability: offer.availability,
    isActive: offer.isActive,
    priority: offer.priority,
    supplierIsActive: offer.supplier.isActive,
  };
}

/** Prisma Decimal -> plain decimal string, trailing zeros trimmed. */
function decimalString(value: DecimalLike): string {
  const fixed = value.toFixed(6);
  return fixed.includes('.') ? fixed.replace(/0+$/u, '').replace(/\.$/u, '') : fixed;
}

/**
 * What counts as an offer a customer can actually buy.
 *
 * Both flags matter and they mean different things: `isActive` is an operator's
 * decision, `isListed` is the venue's. An offer the venue has withdrawn must
 * disappear even before anyone notices, because the purchase would simply fail.
 *
 * Shared by the list count and the detail offers on purpose. Computing them
 * from two different predicates is how a card ends up advertising «12 offers»
 * and opening onto nine.
 */
const topUpOfferVisible = { isActive: true, isListed: true } as const;

/**
 * Supplier catalog keys are normally `{category}:{offer}`. FazerCards' Telegram
 * catalog puts both its Stars and Premium families under the `telegram`
 * namespace, so its adapter receives a three-part key instead. This mapping
 * stays at the catalog boundary: providers continue to receive their own
 * opaque SKU and other game suppliers retain their existing catalog shape.
 */
const TOP_UP_SKU_NAMESPACE_BY_SUPPLIER: Readonly<Record<string, string>> = {
  'fazercards-telegram': 'telegram',
};

function topUpProviderSku(
  supplierCode: string,
  providerCategoryId: string,
  providerOfferId: string,
): string {
  const namespace = TOP_UP_SKU_NAMESPACE_BY_SUPPLIER[supplierCode];
  return [namespace, providerCategoryId, providerOfferId].filter((part) => part !== undefined).join(':');
}

/**
 * The cheapest visible offer, or null.
 *
 * Compared as a `Decimal`, never as a float: these are `Decimal(18,6)` money
 * values and `Math.min` on a parsed number is exactly the rounding the money
 * rules forbid. `toFixed(6)` on the way out keeps the value in the canonical
 * form the rest of the system stores.
 */
function cheapestOffer(
  offers: readonly { readonly costAmount: Prisma.Decimal; readonly costCurrency: string }[],
): { readonly costAmount: DecimalString; readonly costCurrency: string } | null {
  let cheapest: { readonly costAmount: Prisma.Decimal; readonly costCurrency: string } | null = null;
  for (const offer of offers) {
    if (cheapest === null || offer.costAmount.lt(cheapest.costAmount)) {
      cheapest = offer;
    }
  }
  return cheapest === null
    ? null
    : {
        costAmount: decimalString(cheapest.costAmount) as DecimalString,
        costCurrency: cheapest.costCurrency,
      };
}

/**
 * The `[{label, value}]` list a SELECT field carries, or null.
 *
 * Read defensively: `TopUpField.options` is an untyped JSON column filled by a
 * sync against a venue free to change shape, and a malformed block must not
 * take down a customer's page. A value with no label falls back to the value,
 * because an option a customer cannot read is worse than a duplicated string.
 */
function readTopUpFieldOptions(
  options: Prisma.JsonValue | null,
): { readonly label: string; readonly value: string }[] | null {
  if (!Array.isArray(options)) {
    return null;
  }
  const parsed: { label: string; value: string }[] = [];
  for (const entry of options) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, unknown>;
    const value = typeof record['value'] === 'string' ? record['value'] : '';
    if (value === '') {
      continue;
    }
    const label = typeof record['label'] === 'string' && record['label'] !== '' ? record['label'] : value;
    parsed.push({ label, value });
  }
  return parsed.length === 0 ? null : parsed;
}

function pageMeta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.ceil(total / pageSize) };
}

function parseFieldOptions(
  value: Prisma.JsonValue | null,
): Array<{ value: string; labelFa: string }> | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const options: Array<{ value: string; labelFa: string }> = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      continue;
    }
    const record = entry as Record<string, Prisma.JsonValue | undefined>;
    if (typeof record['value'] === 'string' && typeof record['labelFa'] === 'string') {
      options.push({ value: record['value'], labelFa: record['labelFa'] });
    }
  }
  return options;
}
