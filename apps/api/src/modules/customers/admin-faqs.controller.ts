/* eslint-disable @typescript-eslint/consistent-type-imports -- FaqsService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CurrentStaff, RequestMetadata } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import {
  createFaqSchema,
  faqParamSchema,
  updateFaqSchema,
  type CreateFaqInput,
  type FaqParam,
  type UpdateFaqInput,
} from './faqs.schemas';
import { FaqsService } from './faqs.service';

/**
 * Admin-only editing of the FAQ list.
 *
 * Unlike support channels, this set is open: an admin can add a question,
 * reword or reorder any of them, or remove one outright.
 */
@ApiTags('admin-settings')
@Controller('admin/settings/faqs')
@Roles('ADMIN')
export class AdminFaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get()
  @ApiOperation({ summary: 'List every FAQ entry, published or not' })
  list() {
    return this.faqs.listForAdmin();
  }

  @Post()
  @ApiOperation({ summary: 'Add a new FAQ entry' })
  create(
    @Body(zodPipe(createFaqSchema)) body: CreateFaqInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.faqs.create(body, { staff, metadata });
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update one FAQ entry' })
  update(
    @Param(zodPipe(faqParamSchema)) params: FaqParam,
    @Body(zodPipe(updateFaqSchema)) body: UpdateFaqInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.faqs.update(params.id, body, { staff, metadata });
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a FAQ entry' })
  remove(
    @Param(zodPipe(faqParamSchema)) params: FaqParam,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.faqs.remove(params.id, { staff, metadata });
  }
}
