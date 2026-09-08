/* eslint-disable @typescript-eslint/consistent-type-imports -- AdminSettingsService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import {
  createStaffSchema,
  deleteStaffSchema,
  featureFlagParamSchema,
  idParamSchema,
  replaceQueueOperatorsSchema,
  staffStatusSchema,
  updateFeatureFlagSchema,
  updateQueueSchema,
} from './admin-settings.schemas';
import type {
  CreateStaffInput,
  DeleteStaffInput,
  FeatureFlagParam,
  IdParam,
  ReplaceQueueOperatorsInput,
  StaffStatusInput,
  UpdateFeatureFlagInput,
  UpdateQueueInput,
} from './admin-settings.schemas';
import { AdminSettingsService } from './admin-settings.service';
import type { AuthenticatedStaff, IdentityActor } from './identity.tokens';
import { CurrentStaff, RequestMetadata } from './rbac/current-actor.decorator';
import { Roles } from './rbac/roles.decorator';

@ApiTags('admin-settings')
@Controller('admin/settings')
@Roles('ADMIN')
export class AdminSettingsController {
  constructor(private readonly settings: AdminSettingsService) {}

  @Get('staff')
  @ApiOperation({ summary: 'List staff accounts' })
  listStaff() {
    return this.settings.listStaff();
  }

  @Post('staff')
  @ApiOperation({ summary: 'Create an active staff account' })
  createStaff(
    @Body(zodPipe(createStaffSchema)) body: CreateStaffInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.settings.createStaff(body, { staff, metadata });
  }

  @Patch('staff/:id/status')
  @ApiOperation({ summary: 'Activate or deactivate a staff account' })
  setStaffStatus(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(staffStatusSchema)) body: StaffStatusInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.settings.setStaffStatus(params.id, body, { staff, metadata });
  }

  @Post('staff/:id/delete')
  @ApiOperation({ summary: 'Delete a previously deactivated staff account' })
  deleteStaff(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(deleteStaffSchema)) body: DeleteStaffInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.settings.deleteStaff(params.id, body, { staff, metadata });
  }

  @Get('feature-flags')
  @ApiOperation({ summary: 'List feature flags' })
  listFeatureFlags() {
    return this.settings.listFeatureFlags();
  }

  @Patch('feature-flags/:key')
  @ApiOperation({ summary: 'Update a closed-set feature flag' })
  updateFeatureFlag(
    @Param(zodPipe(featureFlagParamSchema)) params: FeatureFlagParam,
    @Body(zodPipe(updateFeatureFlagSchema)) body: UpdateFeatureFlagInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.settings.updateFeatureFlag(params.key, body, { staff, metadata });
  }

  @Get('queues')
  @ApiOperation({ summary: 'List operational queues and memberships' })
  listQueues() {
    return this.settings.listQueues();
  }

  @Patch('queues/:id')
  @ApiOperation({ summary: 'Update queue metadata, status, and SLA' })
  updateQueue(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(updateQueueSchema)) body: UpdateQueueInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.settings.updateQueue(params.id, body, { staff, metadata });
  }

  @Put('queues/:id/operators')
  @ApiOperation({ summary: 'Replace active operator memberships for a queue' })
  replaceQueueOperators(
    @Param(zodPipe(idParamSchema)) params: IdParam,
    @Body(zodPipe(replaceQueueOperatorsSchema)) body: ReplaceQueueOperatorsInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.settings.replaceQueueOperators(params.id, body, { staff, metadata });
  }
}
