import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Put,
  Query,
  StreamableFile,
  Header,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../identity';
import { CatalogGalleryService } from './catalog-gallery.service';
import { CatalogService } from './catalog.service';
import {
  adminBrandListSchema,
  adminCatalogListSchema,
  adminGalleryListSchema,
  assignGalleryImageSchema,
  galleryNameParamSchema,
  adminProductListSchema,
  assignCategorySchema,
  bulkSetProductActiveSchema,
  bulkSetTopUpGameActiveSchema,
  createBrandSchema,
  createCategoryLinkSchema,
  createCategorySchema,
  adminServiceFieldListSchema,
  adminSkuListSchema,
  adminSupplierOfferListSchema,
  adminTopUpGameListSchema,
  createInternationalServiceSchema,
  createProductFaqSchema,
  createProductSchema,
  createServiceFieldSchema,
  createSkuSchema,
  createSupplierOfferSchema,
  createSupplierSchema,
  listFaqsQuerySchema,
  mergeBrandsSchema,
  productFaqIdParamSchema,
  updateBrandSchema,
  updateCategoryLinkSchema,
  updateCategorySchema,
  updateInternationalServiceSchema,
  updateProductFaqSchema,
  updateProductSchema,
  updateServiceFieldSchema,
  updateSkuSchema,
  updateSupplierOfferSchema,
  updateSupplierSchema,
  updateTopUpGameSchema,
  updateTopUpOfferSchema,
} from './catalog.schemas';
import type {
  AdminBrandListInput,
  AdminCatalogListInput,
  AdminGalleryListInput,
  AdminProductListInput,
  AdminServiceFieldListInput,
  AdminSkuListInput,
  AdminSupplierOfferListInput,
  AdminTopUpGameListInput,
  AssignCategoryInput,
  AssignGalleryImageInput,
  BulkSetProductActiveInput,
  BulkSetTopUpGameActiveInput,
  CreateBrandInput,
  CreateCategoryInput,
  CreateCategoryLinkInput,
  CreateInternationalServiceInput,
  CreateProductFaqInput,
  CreateProductInput,
  CreateServiceFieldInput,
  CreateSkuInput,
  CreateSupplierInput,
  CreateSupplierOfferInput,
  ListFaqsQuery,
  MergeBrandsInput,
  ProductFaqIdParam,
  UpdateBrandInput,
  UpdateCategoryInput,
  UpdateCategoryLinkInput,
  UpdateInternationalServiceInput,
  UpdateProductFaqInput,
  UpdateProductInput,
  UpdateServiceFieldInput,
  UpdateSkuInput,
  UpdateSupplierInput,
  UpdateSupplierOfferInput,
  UpdateTopUpGameInput,
  UpdateTopUpOfferInput,
} from './catalog.schemas';

const idParamSchema = z.object({ id: z.string().min(1).max(64) });
type IdParam = z.infer<typeof idParamSchema>;

/**
 * What one gallery page needs from `GET gallery/files/:name`: a page is up to a
 * hundred thumbnails (the list's `pageSize` cap; the panel asks for forty), so
 * the second-level cap covers a whole page and the minute-level one several in
 * a row. The API's global caps are 10 and 120.
 */
export const GALLERY_THUMBNAILS_PER_SECOND = 100;
export const GALLERY_THUMBNAILS_PER_MINUTE = 600;

/**
 * Catalog administration.
 *
 * Suppliers, offers and costs are edited here and nowhere else. The role list is
 * deliberately narrow: an offer's `costAmount` is what the business pays, so a
 * SUPPORT or VIEWER account must not be able to change what a quote is priced
 * from.
 */
@Controller('admin/catalog')
@Roles('ADMIN', 'OPS_MANAGER')
export class CatalogAdminController {
  constructor(
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(CatalogGalleryService) private readonly gallery: CatalogGalleryService,
  ) {}

  @Get('products')
  listProducts(@Query(zodPipe(adminProductListSchema)) query: AdminProductListInput) {
    return this.catalog.adminListProducts(query);
  }

  @Get('products/:id')
  getProduct(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetProduct(params.id);
  }

  @Delete('products/:id')
  archiveProduct(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminArchiveProduct(params.id);
  }

  @Post('products/bulk-active')
  bulkSetProductActive(@Body(zodPipe(bulkSetProductActiveSchema)) body: BulkSetProductActiveInput) {
    return this.catalog.adminBulkSetProductActive(body);
  }

  /* ---------------------------------------------------------- taxonomy */

  /** Every category, empty ones included — an operator manages those too. */
  @Get('categories')
  listCategories() {
    return this.catalog.adminListCategories();
  }

  @Get('categories/:id')
  getCategory(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetCategory(params.id);
  }

  @Post('categories')
  createCategory(@Body(zodPipe(createCategorySchema)) body: CreateCategoryInput) {
    return this.catalog.adminCreateCategory(body);
  }

  @Put('categories/:id')
  updateCategory(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateCategorySchema)) body: UpdateCategoryInput,
  ) {
    return this.catalog.adminUpdateCategory(params.id, body);
  }

  /** Deactivates. Deleting would strip every product in it of its category. */
  @Delete('categories/:id')
  archiveCategory(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminArchiveCategory(params.id);
  }

  @Post('categories/assign')
  assignCategory(@Body(zodPipe(assignCategorySchema)) body: AssignCategoryInput) {
    return this.catalog.adminAssignCategory(body);
  }

  /** Add a service to a service-list category. */
  @Post('categories/:id/links')
  addCategoryLink(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(createCategoryLinkSchema)) body: CreateCategoryLinkInput,
  ) {
    return this.catalog.adminAddCategoryLink(params.id, body);
  }

  @Put('category-links/:id')
  updateCategoryLink(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateCategoryLinkSchema)) body: UpdateCategoryLinkInput,
  ) {
    return this.catalog.adminUpdateCategoryLink(params.id, body);
  }

  @Delete('category-links/:id')
  removeCategoryLink(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminRemoveCategoryLink(params.id);
  }

  @Get('brands')
  listBrands(@Query(zodPipe(adminBrandListSchema)) query: AdminBrandListInput) {
    return this.catalog.adminListBrands(query);
  }

  /** Declared before `brands/:id`, which would otherwise match "options". */
  @Get('brands/options')
  brandOptions() {
    return this.catalog.adminBrandOptions();
  }

  @Get('brands/:id')
  getBrand(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetBrand(params.id);
  }

  @Post('brands')
  createBrand(@Body(zodPipe(createBrandSchema)) body: CreateBrandInput) {
    return this.catalog.adminCreateBrand(body);
  }

  @Put('brands/:id')
  updateBrand(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateBrandSchema)) body: UpdateBrandInput,
  ) {
    return this.catalog.adminUpdateBrand(params.id, body);
  }

  @Delete('brands/:id')
  archiveBrand(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminArchiveBrand(params.id);
  }

  /** Fold a duplicate brand into the real one, keeping its products. */
  @Post('brands/merge')
  mergeBrands(@Body(zodPipe(mergeBrandsSchema)) body: MergeBrandsInput) {
    return this.catalog.adminMergeBrands(body);
  }

  @Post('brands/:id/logo')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
      },
    }),
  )
  uploadBrandLogo(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('A valid image file is required');
    }
    return this.catalog.adminUploadBrandLogo(params.id, file);
  }

  @Get('skus')
  listSkus(@Query(zodPipe(adminSkuListSchema)) query: AdminSkuListInput) {
    return this.catalog.adminListSkus(query);
  }

  @Get('skus/:id')
  getSku(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetSku(params.id);
  }

  @Delete('skus/:id')
  archiveSku(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminArchiveSku(params.id);
  }

  @Get('suppliers')
  listSuppliers(@Query(zodPipe(adminCatalogListSchema)) query: AdminCatalogListInput) {
    return this.catalog.adminListSuppliers(query);
  }

  @Get('suppliers/:id')
  getSupplier(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetSupplier(params.id);
  }

  @Delete('suppliers/:id')
  archiveSupplier(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminArchiveSupplier(params.id);
  }

  @Get('offers')
  listOffers(@Query(zodPipe(adminSupplierOfferListSchema)) query: AdminSupplierOfferListInput) {
    return this.catalog.adminListOffers(query);
  }

  @Get('offers/:id')
  getOffer(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetOffer(params.id);
  }

  @Delete('offers/:id')
  archiveOffer(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminArchiveOffer(params.id);
  }

  @Get('services')
  listServices(@Query(zodPipe(adminCatalogListSchema)) query: AdminCatalogListInput) {
    return this.catalog.adminListServices(query);
  }

  @Get('services/:id')
  getService(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetService(params.id);
  }

  @Delete('services/:id')
  archiveService(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminArchiveService(params.id);
  }

  @Get('service-fields')
  listFields(@Query(zodPipe(adminServiceFieldListSchema)) query: AdminServiceFieldListInput) {
    return this.catalog.adminListFields(query.serviceId);
  }

  @Get('service-fields/:id')
  getField(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetField(params.id);
  }

  @Delete('service-fields/:id')
  deleteField(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminDeleteField(params.id);
  }

  @Post('products')
  createProduct(@Body(zodPipe(createProductSchema)) body: CreateProductInput) {
    return this.catalog.adminCreateProduct(body);
  }

  @Put('products/:id')
  updateProduct(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateProductSchema)) body: UpdateProductInput,
  ) {
    return this.catalog.adminUpdateProduct(params.id, body);
  }

  @Post('products/:id/image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
      },
    }),
  )
  uploadProductImage(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('A valid image file is required');
    }
    return this.catalog.adminUploadProductImage(params.id, file);
  }

  /* ---------------------------------------------------------- image gallery */

  /** Every image uploaded so far — products', brands', games' and the gallery's own. */
  @Get('gallery')
  listGallery(@Query(zodPipe(adminGalleryListSchema)) query: AdminGalleryListInput) {
    return this.gallery.list(query);
  }

  @Post('gallery')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
      },
    }),
  )
  uploadGalleryImage(
    @UploadedFile() file: { mimetype: string; buffer: Buffer; originalname?: string } | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('A valid image file is required');
    }
    return this.gallery.upload(file);
  }

  /**
   * The bytes of one gallery file, for the panel's own thumbnails. Behind the
   * admin guard rather than public: an image that is only in the gallery is not
   * on the storefront yet, and should not be reachable from it.
   *
   * Throttled more loosely than the rest of the API, on purpose. One gallery
   * page is forty `<img>` tags, each its own request, and the browser sends them
   * together; under the global 10 a second the first ten loaded and the other
   * thirty came back 429 and showed as broken pictures. This only reads a file
   * the caller is already signed in as an admin to see, so the headroom is for a
   * page of thumbnails and a few pages turned quickly.
   */
  @Get('gallery/files/:name')
  @Throttle({ short: { ttl: 1_000, limit: GALLERY_THUMBNAILS_PER_SECOND }, medium: { ttl: 60_000, limit: GALLERY_THUMBNAILS_PER_MINUTE } })
  @Header('Cache-Control', 'private, max-age=0, must-revalidate')
  @Header('X-Content-Type-Options', 'nosniff')
  async galleryFile(@Param(zodPipe(galleryNameParamSchema)) params: { name: string }) {
    const image = await this.gallery.read(params.name);
    return new StreamableFile(image.buffer, { type: image.contentType });
  }

  @Delete('gallery/files/:name')
  removeGalleryImage(@Param(zodPipe(galleryNameParamSchema)) params: { name: string }) {
    return this.gallery.remove(params.name);
  }

  /** Gives a product a copy of a gallery image as its own. */
  @Post('products/:id/image/from-gallery')
  useGalleryImage(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(assignGalleryImageSchema)) body: AssignGalleryImageInput,
  ) {
    return this.gallery.useForProduct(params.id, body.name);
  }

  @Post('skus')
  createSku(@Body(zodPipe(createSkuSchema)) body: CreateSkuInput) {
    return this.catalog.adminCreateSku(body);
  }

  @Put('skus/:id')
  updateSku(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateSkuSchema)) body: UpdateSkuInput,
  ) {
    return this.catalog.adminUpdateSku(params.id, body);
  }

  @Post('suppliers')
  createSupplier(@Body(zodPipe(createSupplierSchema)) body: CreateSupplierInput) {
    return this.catalog.adminCreateSupplier(body);
  }

  @Put('suppliers/:id')
  updateSupplier(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateSupplierSchema)) body: UpdateSupplierInput,
  ) {
    return this.catalog.adminUpdateSupplier(params.id, body);
  }

  @Post('offers')
  createOffer(@Body(zodPipe(createSupplierOfferSchema)) body: CreateSupplierOfferInput) {
    return this.catalog.adminCreateOffer(body);
  }

  @Put('offers/:id')
  updateOffer(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateSupplierOfferSchema)) body: UpdateSupplierOfferInput,
  ) {
    return this.catalog.adminUpdateOffer(params.id, body);
  }

  /* ------------------------------------------------- direct top-up */

  /**
   * The games a customer can be charged for, and the switch that puts each one
   * on sale.
   *
   * Read and written here rather than through `CatalogService.public…`: a game
   * is only sellable when the game, its supplier and the specific offer are all
   * active, so an operator needs to see all three flags side by side. A synced
   * game arrives inactive on purpose — that is the review step this screen is.
   */
  @Get('top-ups')
  listTopUpGames(@Query(zodPipe(adminTopUpGameListSchema)) query: AdminTopUpGameListInput) {
    return this.catalog.adminListTopUpGames(query);
  }

  @Get('top-ups/:id')
  getTopUpGame(@Param(zodPipe(idParamSchema)) params: IdParam) {
    return this.catalog.adminGetTopUpGame(params.id);
  }

  @Put('top-ups/:id')
  updateTopUpGame(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateTopUpGameSchema)) body: UpdateTopUpGameInput,
  ) {
    return this.catalog.adminUpdateTopUpGame(params.id, body);
  }

  @Post('top-ups/:id/image')
  @UseInterceptors(
    FileInterceptor('image', {
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_request, file, callback) => {
        callback(null, ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype));
      },
    }),
  )
  uploadTopUpGameImage(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @UploadedFile() file: { mimetype: string; buffer: Buffer } | undefined,
  ) {
    if (!file) {
      throw new BadRequestException('A valid image file is required');
    }
    return this.catalog.adminUploadTopUpGameImage(params.id, file);
  }

  @Post('top-ups/bulk-active')
  bulkSetTopUpGameActive(
    @Body(zodPipe(bulkSetTopUpGameActiveSchema)) body: BulkSetTopUpGameActiveInput,
  ) {
    return this.catalog.adminBulkSetTopUpGameActive(body);
  }

  @Put('top-up-offers/:id')
  updateTopUpOffer(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateTopUpOfferSchema)) body: UpdateTopUpOfferInput,
  ) {
    return this.catalog.adminUpdateTopUpOffer(params.id, body);
  }

  @Post('services')
  createService(
    @Body(zodPipe(createInternationalServiceSchema)) body: CreateInternationalServiceInput,
  ) {
    return this.catalog.adminCreateService(body);
  }

  @Put('services/:id')
  updateService(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateInternationalServiceSchema)) body: UpdateInternationalServiceInput,
  ) {
    return this.catalog.adminUpdateService(params.id, body);
  }

  @Post('service-fields')
  createField(@Body(zodPipe(createServiceFieldSchema)) body: CreateServiceFieldInput) {
    return this.catalog.adminCreateField(body);
  }

  @Put('service-fields/:id')
  updateField(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateServiceFieldSchema)) body: UpdateServiceFieldInput,
  ) {
    return this.catalog.adminUpdateField(params.id, body);
  }

  /* ---------------------------------------------------- per-product FAQs */

  /** Admin list: all FAQs for a product, including disabled ones. */
  @Get('faqs')
  listFaqs(@Query(zodPipe(listFaqsQuerySchema)) query: ListFaqsQuery) {
    return this.catalog.adminListFaqs(query.itemType, query.itemSlug);
  }

  @Post('faqs')
  createFaq(@Body(zodPipe(createProductFaqSchema)) body: CreateProductFaqInput) {
    return this.catalog.adminCreateFaq(body);
  }

  @Put('faqs/:id')
  updateFaq(
    @Param(zodPipe(productFaqIdParamSchema)) params: ProductFaqIdParam,
    @Body(zodPipe(updateProductFaqSchema)) body: UpdateProductFaqInput,
  ) {
    return this.catalog.adminUpdateFaq(params.id, body);
  }

  @Delete('faqs/:id')
  deleteFaq(@Param(zodPipe(productFaqIdParamSchema)) params: ProductFaqIdParam) {
    return this.catalog.adminDeleteFaq(params.id);
  }
}
