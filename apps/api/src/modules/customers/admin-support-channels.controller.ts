/* eslint-disable @typescript-eslint/consistent-type-imports -- SupportChannelsService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CurrentStaff, RequestMetadata } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import {
  supportChannelParamSchema,
  updateSupportChannelSchema,
  type SupportChannelParam,
  type UpdateSupportChannelInput,
} from './support-channels.schemas';
import { SupportChannelsService } from './support-channels.service';

/**
 * Admin-only editing of the support channels.
 *
 * Deliberately no create or delete: the four rows exist from the migration, so
 * the only thing an admin can do is fill one in, reword it, reorder it, or
 * switch it off.
 */
@ApiTags('admin-settings')
@Controller('admin/settings/support-channels')
@Roles('ADMIN')
export class AdminSupportChannelsController {
  constructor(private readonly channels: SupportChannelsService) {}

  @Get()
  @ApiOperation({ summary: 'List every support channel, configured or not' })
  list() {
    return this.channels.listForAdmin();
  }

  @Patch(':kind')
  @ApiOperation({ summary: 'Update one support channel' })
  update(
    @Param(zodPipe(supportChannelParamSchema)) params: SupportChannelParam,
    @Body(zodPipe(updateSupportChannelSchema)) body: UpdateSupportChannelInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.channels.update(params.kind, body, { staff, metadata });
  }
}
