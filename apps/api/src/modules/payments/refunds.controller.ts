import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import {
  completeRefundRequestSchema,
  listRefundsQuerySchema,
  rejectRefundRequestSchema,
  type CompleteRefundRequest,
  type ListRefundsQuery,
  type ListRefundsResponse,
  type RejectRefundRequest,
  type StaffRefundDto,
} from '@barat/contracts';

import { DomainErrors } from '../../common/errors/domain.exception';
import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedStaff } from '../identity/identity.tokens';
import { CurrentStaff } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import { RefundsService } from './refunds.service';

/**
 * The finance refund queue. Every route is FINANCE or ADMIN: a refund moves
 * money out, which is a finance decision, not an operator's.
 */
@Roles('ADMIN', 'FINANCE')
@Controller('admin/refunds')
export class RefundsController {
  constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @Get()
  async list(@Query(zodPipe(listRefundsQuerySchema)) query: ListRefundsQuery): Promise<ListRefundsResponse> {
    return { items: await this.refunds.list(query) };
  }

  @Post(':id/approve')
  async approve(@Param('id') id: string, @CurrentStaff() staff: AuthenticatedStaff): Promise<StaffRefundDto> {
    return this.refunds.approve(refundId(id), staff);
  }

  @Post(':id/complete')
  async complete(
    @Param('id') id: string,
    @Body(zodPipe(completeRefundRequestSchema)) body: CompleteRefundRequest,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StaffRefundDto> {
    return this.refunds.complete(refundId(id), body.bankReference, staff);
  }

  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body(zodPipe(rejectRefundRequestSchema)) body: RejectRefundRequest,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<StaffRefundDto> {
    return this.refunds.reject(refundId(id), body.reason, staff);
  }
}

function refundId(raw: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/u.test(raw)) {
    throw DomainErrors.validation([{ path: 'id', message: 'Invalid refund id' }]);
  }
  return raw;
}
