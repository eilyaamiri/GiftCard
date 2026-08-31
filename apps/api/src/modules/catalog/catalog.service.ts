/* eslint-disable @typescript-eslint/consistent-type-imports -- AppConfigService is
 * constructor-injected; emitDecoratorMetadata needs the runtime class value. */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import Decimal from 'decimal.js';
import { Prisma } from '@barat/database';
import type {
  DecimalString,
  GetProductResponse,
  InternationalServiceDto,
  ListProductsRequest,
  ListProductsResponse,
  ListServicesResponse,
  ProductDto,
  ServiceFieldDefinitionDto,
  SkuDto,
} from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { AppConfigService } from '../../common/config/app-config.service';
import { selectBestOffer, type SelectableOffer } from '../quotes/supplier-offer-selection';
import { CATALOG_DATABASE, type CatalogDatabase } from './catalog.tokens';
import {
  createInternationalServiceSchema,
  createProductSchema,
  createServiceFieldSchema,
  createSkuSchema,
  createSupplierOfferSchema,
  createSupplierSchema,
  updateInternationalServiceSchema,
  updateProductSchema,
  updateServiceFieldSchema,
  updateSkuSchema,
  updateSupplierOfferSchema,
  updateSupplierSchema,
  type AdminCatalogListInput,
  type AdminSkuListInput,
  type AdminSupplierOfferListInput,
  type CreateInternationalServiceInput,
  type CreateProductInput,
  type CreateServiceFieldInput,
  type CreateSkuInput,
  type CreateSupplierInput,
  type CreateSupplierOfferInput,
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
  sortOrder: true,
  createdAt: true,
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

type DecimalLike = { toFixed(decimalPlaces?: number): string };

const IMAGE_VARIANTS = [
  { extension: 'jpg', contentType: 'image/jpeg' },
  { extension: 'png', contentType: 'image/png' },
  { extension: 'webp', contentType: 'image/webp' },
  { extension: 'gif', contentType: 'image/gif' },
] as const;

function imagePath(root: string, productId: string, extension: string): string {
  return path.join(root, `${productId}.${extension}`);
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
    @Optional() private readonly config?: AppConfigService,
  ) {}

  /* ------------------------------------------------------------------ public */

  async listProducts(input: ListProductsRequest): Promise<ListProductsResponse> {
    const { page, pageSize } = input;
    const skuFilter: Prisma.SkuWhereInput = {
      isActive: true,
      ...(input.region ? { region: input.region } : {}),
      ...(input.onlyAvailable
        ? {
            supplierOffers: {
              some: {
                isActive: true,
                availability: 'AVAILABLE',
                supplier: { isActive: true },
              },
            },
          }
        : {}),
    };

    const where: Prisma.ProductWhereInput = {
      isActive: true,
      ...(input.category ? { category: input.category } : {}),
      ...(input.brand ? { brand: input.brand } : {}),
      ...(input.search
        ? {
            OR: [
              { title: { contains: input.search, mode: 'insensitive' } },
              { titleFa: { contains: input.search } },
              { brand: { contains: input.search, mode: 'insensitive' } },
            ],
          }
        : {}),
      ...(input.region || input.onlyAvailable ? { skus: { some: skuFilter } } : {}),
    };

    const [rows, total] = await this.db.$transaction([
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
    ]);

    return {
      items: rows.map((row) => this.toProductDto(row, row.skus)),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  async getProduct(slug: string, region?: string): Promise<GetProductResponse> {
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
    const availableSkuIds = await this.availableSkuIds(visibleSkus.map((sku) => sku.id));

    return {
      product: {
        ...this.toProductDto(product, regions),
        redemptionNotesFa: product.redemptionNotesFa,
        skus: visibleSkus.map((sku) => this.toSkuDto(sku, availableSkuIds.has(sku.id))),
      },
    };
  }

  async listServices(page = 1, pageSize = 20): Promise<ListServicesResponse> {
    const where: Prisma.InternationalServiceWhereInput = { isActive: true };
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

  /* -------------------------------------------------------- quote-facing API */

  /**
   * Resolve the SKU and the supplier offer a quote should be priced against.
   *
   * This is the ONLY place supplier data crosses into the quote flow, and the
   * returned identity/cost is for internal pricing and the operator's purchase
   * task — it is never projected into a customer-facing DTO.
   */
  async getSkuQuoteTarget(skuId: string, currency: string): Promise<SkuQuoteTarget> {
    const sku = await this.db.sku.findFirst({
      where: { id: skuId, isActive: true, product: { isActive: true } },
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

  /* ---------------------------------------------------------------- admin */

  async adminListProducts(query: AdminCatalogListInput) {
    const where: Prisma.ProductWhereInput = query.includeInactive ? {} : { isActive: true };
    const [items, total] = await this.db.$transaction([
      this.db.product.findMany({
        where,
        include: { _count: { select: { skus: true } } },
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
    return this.db.product.create({ data: createProductSchema.parse(input) });
  }

  async adminUpdateProduct(id: string, input: UpdateProductInput) {
    const data = updateProductSchema.parse(input);
    await this.assertExists(this.db.product.count({ where: { id } }), 'product');
    return this.db.product.update({ where: { id }, data });
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
    const extension = imageExtension(file);
    if (!extension) {
      throw DomainErrors.validation([
        { path: 'file', message: 'تصویر باید یک فایل معتبر JPG، PNG، WebP یا GIF باشد.' },
      ]);
    }

    const root = this.config?.productImageDir ?? path.join(process.cwd(), 'data', 'product-images');
    await fs.mkdir(root, { recursive: true });
    await Promise.all(
      IMAGE_VARIANTS.filter((variant) => variant.extension !== extension).map((variant) =>
        fs.rm(imagePath(root, id, variant.extension), { force: true }),
      ),
    );
    await fs.writeFile(imagePath(root, id, extension), file.buffer, { mode: 0o640 });

    return this.db.product.update({
      where: { id },
      data: { imageUrl: `/api/catalog/products/${id}/image` },
    });
  }

  async productImage(id: string): Promise<{ buffer: Buffer; contentType: string }> {
    await this.assertExists(this.db.product.count({ where: { id } }), 'product');
    for (const variant of IMAGE_VARIANTS) {
      try {
        return {
          buffer: await fs.readFile(imagePath(this.config?.productImageDir ?? path.join(process.cwd(), 'data', 'product-images'), id, variant.extension)),
          contentType: variant.contentType,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    throw DomainErrors.notFound('product image');
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
      where: {
        skuId: { in: [...skuIds] },
        isActive: true,
        availability: 'AVAILABLE',
        supplier: { isActive: true },
      },
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
      sortOrder: number;
      createdAt: Date;
    },
    skuRegions: ReadonlyArray<{ region: string }>,
  ): ProductDto {
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
