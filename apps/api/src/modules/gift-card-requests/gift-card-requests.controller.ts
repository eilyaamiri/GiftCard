import { Body, Controller, Get, Inject, Post, Param, Query } from '@nestjs/common';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentStaff } from '../identity/rbac/current-actor.decorator';
import type { AuthenticatedStaff } from '../identity/identity.tokens';
import { Roles } from '../identity/rbac/roles.decorator';
import {
  createGiftCardRequestSchema,
  fulfillGiftCardRequestSchema,
  listGiftCardRequestsQuerySchema,
  type CreateGiftCardRequest,
  type FulfillGiftCardRequest,
  type ListGiftCardRequestsQuery,
} from './gift-card-requests.schemas';
import { GiftCardRequestsService } from './gift-card-requests.service';

@Controller('gift-card-requests')
export class GiftCardRequestsController {
  constructor(@Inject(GiftCardRequestsService) private readonly requests: GiftCardRequestsService) {}

  @Get()
  @Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER')
  list(@Query(zodPipe(listGiftCardRequestsQuerySchema)) query: ListGiftCardRequestsQuery) {
    return this.requests.list(query.status);
  }

  @Get('mine')
  @Roles('OPERATOR')
  mine(@CurrentStaff() staff: AuthenticatedStaff) {
    return this.requests.listMine(staff);
  }

  @Post()
  @Roles('OPERATOR')
  create(@Body(zodPipe(createGiftCardRequestSchema)) body: CreateGiftCardRequest, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.requests.create({ staff, ...body });
  }

  @Post(':id/fulfill')
  @Roles('ADMIN', 'MANAGEMENT', 'OPS_MANAGER')
  fulfill(@Param('id') id: string, @Body(zodPipe(fulfillGiftCardRequestSchema)) body: FulfillGiftCardRequest, @CurrentStaff() staff: AuthenticatedStaff) {
    return this.requests.fulfill({ staff, requestId: id, ...body });
  }
}
