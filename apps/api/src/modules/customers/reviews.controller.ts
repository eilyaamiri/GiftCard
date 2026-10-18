/* eslint-disable @typescript-eslint/consistent-type-imports -- ReviewsService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Public } from '../identity';
import { listReviewsQuerySchema, type ListReviewsQuery } from './reviews.schemas';
import { ReviewsService, type ListReviewsResponse } from './reviews.service';

/**
 * The reviews a product page shows, for anyone.
 *
 * Public because the reviews tab renders before a visitor has an account. Only
 * APPROVED reviews and an approved-only average ever come back from here; a
 * customer's own pending review is read through `/api/account/reviews/mine`.
 */
@ApiTags('reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: "A product's approved reviews and rating summary" })
  list(@Query(zodPipe(listReviewsQuerySchema)) query: ListReviewsQuery): Promise<ListReviewsResponse> {
    return this.reviews.listPublic(query);
  }
}
