/* eslint-disable @typescript-eslint/consistent-type-imports -- KbService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import type { AuthenticatedStaff, IdentityActor } from '../identity/identity.tokens';
import { CurrentStaff, RequestMetadata } from '../identity/rbac/current-actor.decorator';
import { Roles } from '../identity/rbac/roles.decorator';
import {
  articleParamSchema,
  categoryParamSchema,
  createKbArticleSchema,
  createKbCategorySchema,
  updateKbArticleSchema,
  updateKbCategorySchema,
  type ArticleParam,
  type CategoryParam,
  type CreateKbArticleInput,
  type CreateKbCategoryInput,
  type UpdateKbArticleInput,
  type UpdateKbCategoryInput,
} from './kb.schemas';
import { KbService } from './kb.service';

/**
 * Admin-only editing of the knowledge base.
 *
 * Both categories and articles are an open set: an admin can add, reorder,
 * reword or remove any of them, same as the FAQ list.
 */
@ApiTags('admin-kb')
@Controller('admin/knowledge-base')
@Roles('ADMIN')
export class AdminKbController {
  constructor(private readonly kb: KbService) {}

  @Get()
  @ApiOperation({ summary: 'List every knowledge base category and article, published or not' })
  list() {
    return this.kb.listForAdmin();
  }

  @Post('categories')
  @ApiOperation({ summary: 'Add a new knowledge base category' })
  createCategory(
    @Body(zodPipe(createKbCategorySchema)) body: CreateKbCategoryInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.kb.createCategory(body, { staff, metadata });
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update a knowledge base category' })
  updateCategory(
    @Param(zodPipe(categoryParamSchema)) params: CategoryParam,
    @Body(zodPipe(updateKbCategorySchema)) body: UpdateKbCategoryInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.kb.updateCategory(params.id, body, { staff, metadata });
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Remove a knowledge base category and its articles' })
  removeCategory(
    @Param(zodPipe(categoryParamSchema)) params: CategoryParam,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.kb.removeCategory(params.id, { staff, metadata });
  }

  @Post('articles')
  @ApiOperation({ summary: 'Add a new knowledge base article' })
  createArticle(
    @Body(zodPipe(createKbArticleSchema)) body: CreateKbArticleInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.kb.createArticle(body, { staff, metadata });
  }

  @Patch('articles/:id')
  @ApiOperation({ summary: 'Update a knowledge base article' })
  updateArticle(
    @Param(zodPipe(articleParamSchema)) params: ArticleParam,
    @Body(zodPipe(updateKbArticleSchema)) body: UpdateKbArticleInput,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.kb.updateArticle(params.id, body, { staff, metadata });
  }

  @Delete('articles/:id')
  @ApiOperation({ summary: 'Remove a knowledge base article' })
  removeArticle(
    @Param(zodPipe(articleParamSchema)) params: ArticleParam,
    @CurrentStaff() staff: AuthenticatedStaff,
    @RequestMetadata() metadata: IdentityActor,
  ) {
    return this.kb.removeArticle(params.id, { staff, metadata });
  }
}
