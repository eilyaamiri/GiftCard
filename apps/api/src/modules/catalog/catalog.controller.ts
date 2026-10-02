import { Controller, Get, Inject, Param, Query, StreamableFile, Header } from '@nestjs/common';
import { z } from 'zod';
import { getProductRequestSchema, listProductsRequestSchema } from '@barat/contracts';
import type {
  GetTopUpGameResponse,
  ListProductsRequest,
  ListServicesResponse,
  ListTopUpGamesResponse,
} from '@barat/contracts';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../identity';
import { CatalogService, type CatalogTaxonomyFilters } from './catalog.service';
import type {
  GetCatalogProductResponse,
  ListBrandsResponse,
  ListCatalogProductsResponse,
  ListCategoriesResponse,
} from './catalog-taxonomy.dto';

const slugSchema = z.string().trim().min(1).max(90);

/**
 * `?brandSlugs=netflix,steam,xbox` — the brands a caller will display.
 *
 * Comma-separated rather than a repeated key, because it goes on every
 * storefront catalog request and the repeated form triples the length. Capped
 * at 200: the catalog has ~325 brands, so a caller wanting more than that is
 * better off omitting it, and the cap is what keeps the `IN` list bounded.
 */
const brandSlugsSchema = z
  .string()
  .optional()
  .transform((value) => {
    const slugs = (value ?? '')
      .split(',')
      .map((slug) => slug.trim())
      .filter((slug) => slug.length > 0 && slug.length <= 90);
    return slugs.length > 0 ? slugs.slice(0, 200) : undefined;
  });

/**
 * `listProductsRequestSchema` is the frozen contract and has no field for a
 * category or brand slug, and `.parse` would drop one silently. So the contract
 * validates what it knows and the two taxonomy filters are carried alongside
 * it — the request is still exactly the contract plus named extras, not a
 * looser version of it.
 */
const listProductsQuerySchema = z
  .object({
    category: z.string().optional(),
    brand: z.string().optional(),
    categorySlug: slugSchema.optional(),
    brandSlug: slugSchema.optional(),
    brandSlugs: brandSlugsSchema,
    region: z.string().optional(),
    search: z.string().max(120).optional(),
    onlyAvailable: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(true),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .transform((value) => ({
    ...listProductsRequestSchema.parse(value),
    categorySlug: value.categorySlug,
    brandSlug: value.brandSlug,
    brandSlugs: value.brandSlugs,
  }));

const brandScopeQuerySchema = z.object({ brandSlugs: brandSlugsSchema });

const listServicesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().max(120).optional(),
  category: z.string().max(90).optional(),
});
type ListServicesQuery = z.infer<typeof listServicesQuerySchema>;

const productQuerySchema = z.object({ region: z.string().trim().min(2).max(8).optional() });

/**
 * The games list is unpaginated: a curated top-up catalogue is a handful of
 * entries an operator has deliberately switched on, not a 7,000-row catalogue,
 * so a page parameter would be a knob nobody turns. `search` exists because the
 * list will still grow past what fits on one screen.
 */
const listTopUpGamesQuerySchema = z.object({ search: z.string().trim().max(120).optional() });
type ListTopUpGamesQuery = z.infer<typeof listTopUpGamesQuerySchema>;

/*
 * A top-up slug is ours (`telegram-stars`) and a 90-character one is a bad
 * request worth rejecting before it reaches a query.
 */

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
    @Query(zodPipe(listProductsQuerySchema)) query: ListProductsRequest & CatalogTaxonomyFilters,
  ): Promise<ListCatalogProductsResponse> {
    return this.catalog.listProducts(query);
  }

  /** The category tiles on the catalog page. Empty categories are left out. */
  @Get('categories')
  listCategories(
    @Query(zodPipe(brandScopeQuerySchema)) query: { brandSlugs?: readonly string[] | undefined },
  ): Promise<ListCategoriesResponse> {
    return this.catalog.listCategories(query.brandSlugs);
  }

  /** Every brand with something on sale, popular ones flagged, not separated. */
  @Get('brands')
  listBrands(
    @Query(zodPipe(brandScopeQuerySchema)) query: { brandSlugs?: readonly string[] | undefined },
  ): Promise<ListBrandsResponse> {
    return this.catalog.listBrands(query.brandSlugs);
  }

  /** Serves the uploaded logo. `Brand.logoUrl` points straight at this route. */
  @Get('brands/:id/logo')
  @Header('Cache-Control', 'public, max-age=0, must-revalidate')
  async brandLogo(@Param('id') id: string): Promise<StreamableFile> {
    const image = await this.catalog.brandLogo(id);
    return new StreamableFile(image.buffer, { type: image.contentType });
  }

  @Get('top-ups/:id/image')
  @Header('Cache-Control', 'public, max-age=0, must-revalidate')
  async topUpGameImage(@Param('id') id: string): Promise<StreamableFile> {
    const image = await this.catalog.topUpGameImage(id);
    return new StreamableFile(image.buffer, { type: image.contentType });
  }

  @Get('products/:id/image')
  @Header('Cache-Control', 'public, max-age=0, must-revalidate')
  async productImage(@Param('id') id: string): Promise<StreamableFile> {
    const image = await this.catalog.productImage(id);
    return new StreamableFile(image.buffer, { type: image.contentType });
  }

  @Get('products/:slug')
  getProduct(
    @Param(zodPipe(getProductRequestSchema.pick({ slug: true }))) params: { slug: string },
    @Query(zodPipe(productQuerySchema)) query: { region?: string },
  ): Promise<GetCatalogProductResponse> {
    return this.catalog.getProduct(params.slug, query.region);
  }

  @Get('services')
  listServices(
    @Query(zodPipe(listServicesQuerySchema)) query: ListServicesQuery,
  ): Promise<ListServicesResponse> {
    return this.catalog.listServices(query.page, query.pageSize, query.search, query.category);
  }

  /* ------------------------------------------------------------------ top-ups */

  /**
   * The games section of the storefront.
   *
   * An empty list — never an error — is the answer when nothing is on sale:
   * an inactive supplier, or games synced but not yet curated by an operator.
   * The storefront renders «فعلاً چیزی برای شارژ نیست» and the operator decides
   * when that becomes untrue. A 404 here would make a commercial decision look
   * like a bug, and would page whoever is on call for nothing.
   */
  @Get('top-ups')
  listTopUpGames(
    @Query(zodPipe(listTopUpGamesQuerySchema)) query: ListTopUpGamesQuery,
  ): Promise<ListTopUpGamesResponse> {
    return this.catalog.listTopUpGames({ search: query.search });
  }

  /**
   * One game, its account form and its offers.
   *
   * 404 for anything not sellable, including a game that requires credentials.
   * The storefront must treat "not purchasable" and "does not exist" the same
   * way, so the two are the same response.
   */
  @Get('top-ups/:slug')
  getTopUpGame(
    @Param(zodPipe(z.object({ slug: slugSchema }))) params: { slug: string },
  ): Promise<GetTopUpGameResponse> {
    return this.catalog.getTopUpGame(params.slug);
  }
}
