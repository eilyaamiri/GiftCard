import { Controller, Get, Inject, Param, Query } from '@nestjs/common';
import { z } from 'zod';
import { getProductRequestSchema, listProductsRequestSchema } from '@barat/contracts';
import type {
  GetProductResponse,
  ListProductsRequest,
  ListProductsResponse,
  ListServicesResponse,
} from '@barat/contracts';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../identity';
import { CatalogService } from './catalog.service';

const listProductsQuerySchema = z
  .object({
    category: z.string().optional(),
    brand: z.string().optional(),
    region: z.string().optional(),
    search: z.string().max(120).optional(),
    onlyAvailable: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(true),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .transform((value) => listProductsRequestSchema.parse(value));

const listServicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;

const productQuerySchema = z.object({ region: z.string().trim().min(2).max(8).optional() });

/**
 * The public storefront catalog.
 *
 * `@Public()` — browsing must work before login. Every response comes from the
 * `*_PUBLIC_SELECT` projections in `CatalogService`, which contain no supplier
 * and no cost column, so a supplier identity cannot reach a customer here.
 */
@Controller('catalog')
@Public()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('products')
  listProducts(
    @Query(zodPipe(listProductsQuerySchema)) query: ListProductsRequest,
  ): Promise<ListProductsResponse> {
    return this.catalog.listProducts(query);
  }

  @Get('products/:slug')
  getProduct(
    @Param(zodPipe(getProductRequestSchema.pick({ slug: true }))) params: { slug: string },
    @Query(zodPipe(productQuerySchema)) query: { region?: string },
  ): Promise<GetProductResponse> {
    return this.catalog.getProduct(params.slug, query.region);
  }

  @Get('services')
  listServices(
    @Query(zodPipe(listServicesQuerySchema)) query: ListServicesQuery,
  ): Promise<ListServicesResponse> {
    return this.catalog.listServices(query.page, query.pageSize);
  }
}
