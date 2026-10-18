/* eslint-disable @typescript-eslint/consistent-type-imports -- ReviewModerationService
 * is constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CurrentStaff, RequestMetadata } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import { ReviewModerationService, type AdminReviewListDto } from './review-moderation.service';
import {
  adminListReviewsQuerySchema,
  moderateReviewSchema,
  reviewIdParamSchema,
  type AdminListReviewsQuery,
  type ModerateReviewInput,
  type ReviewIdParam,
} from './reviews.schemas';
import type { ReviewStatus } from './reviews.service';

/**
 * The review moderation queue.
 *
 * The people who already answer customers — support, ops managers, admins —
 * decide what customer-written text appears on the storefront.
 */
@ApiTags('admin-reviews')
@Controller('admin/reviews')
@Roles('ADMIN', 'OPS_MANAGER', 'SUPPORT')
export class AdminReviewsController {
  constructor(private readonly moderation: ReviewModerationService) {}

  @Get()
  @ApiOperation({ summary: 'Reviews in one moderation state, with the count in each' })
  list(@Query(zodPipe(adminListReviewsQuerySchema)) query: AdminListReviewsQuery): Promise<AdminReviewListDto> {
    return this.moderation.list(query);
  }

  @Post(':id/decision')
  @ApiOperation({ summary: 'Approve or reject the exact version of a review the moderator read' })
  decide(
    @Param(zodPipe(reviewIdParamSchema)) params: ReviewIdParam,
    @Body(zodPipe(moderateReviewSchema)) body: ModerateReviewInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ): Promise<{ status: ReviewStatus }> {
    return this.moderation.moderate(params.id, body, { staff, metadata });
  }
}
