import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import {
  closeSupportTicketSchema,
  supportReplySchema,
  type CloseSupportTicket,
  type SupportReply,
} from '../identity/identity.schemas';
import type { AuthenticatedStaff } from '../identity/identity.tokens';
import { CurrentStaff } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import { SupportService, type SupportTicketDto } from './support.service';

const SUPPORT_ROLES = ['ADMIN', 'MANAGEMENT', 'OPS_MANAGER', 'OPERATOR', 'SUPPORT'] as const;

@ApiTags('support')
@Controller('support/tickets')
export class SupportController {
  constructor(@Inject(SupportService) private readonly support: SupportService) {}

  @Get()
  @Roles(...SUPPORT_ROLES)
  @ApiOperation({ summary: 'List customer support tickets' })
  list(): Promise<readonly SupportTicketDto[]> {
    return this.support.listAll();
  }

  @Get(':ticketId')
  @Roles(...SUPPORT_ROLES)
  @ApiOperation({ summary: 'View a ticket conversation and ownership history' })
  get(@Param('ticketId') ticketId: string): Promise<SupportTicketDto> {
    return this.support.getForStaff(ticketId);
  }

  @Post(':ticketId/messages')
  @Roles(...SUPPORT_ROLES)
  @ApiOperation({ summary: 'Reply to a customer ticket' })
  reply(
    @Param('ticketId') ticketId: string,
    @Body(zodPipe(supportReplySchema)) body: SupportReply,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<SupportTicketDto> {
    return this.support.replyAsStaff(staff, ticketId, body);
  }

  @Post(':ticketId/close')
  @Roles(...SUPPORT_ROLES)
  @ApiOperation({ summary: 'Close a customer ticket' })
  close(
    @Param('ticketId') ticketId: string,
    @Body(zodPipe(closeSupportTicketSchema)) body: CloseSupportTicket,
    @CurrentStaff() staff: AuthenticatedStaff,
  ): Promise<SupportTicketDto> {
    return this.support.close(staff, ticketId, body.resolutionNote);
  }
}
