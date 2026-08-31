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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../identity';
import { CatalogService } from './catalog.service';
import {
  adminCatalogListSchema,
  adminServiceFieldListSchema,
  adminSkuListSchema,
  adminSupplierOfferListSchema,
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
} from './catalog.schemas';
import type {
  AdminCatalogListInput,
  AdminServiceFieldListInput,
  AdminSkuListInput,
  AdminSupplierOfferListInput,
  CreateInternationalServiceInput,
  CreateProductInput,
  CreateServiceFieldInput,
  CreateSkuInput,
  CreateSupplierInput,
  CreateSupplierOfferInput,
  UpdateInternationalServiceInput,
  UpdateProductInput,
  UpdateServiceFieldInput,
  UpdateSkuInput,
  UpdateSupplierInput,
  UpdateSupplierOfferInput,
} from './catalog.schemas';

const idParamSchema = z.object({ id: z.string().min(1).max(64) });
type IdParam = z.infer<typeof idParamSchema>;

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
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('products')
  listProducts(@Query(zodPipe(adminCatalogListSchema)) query: AdminCatalogListInput) {
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
}
