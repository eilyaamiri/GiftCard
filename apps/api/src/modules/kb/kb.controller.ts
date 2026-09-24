/* eslint-disable @typescript-eslint/consistent-type-imports -- KbService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../identity';
import { KbService, type PublicKbCategoryDto } from './kb.service';

/**
 * The storefront's knowledge base ("راهنما"), for anyone.
 *
 * Public because visitors browse and search `/help` before having an account.
 * Only published categories/articles are returned, already in display order.
 */
@ApiTags('kb')
@Controller('kb')
export class KbController {
  constructor(private readonly kb: KbService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List the knowledge base content currently published to customers' })
  list(): Promise<{ categories: readonly PublicKbCategoryDto[] }> {
    return this.kb.listPublicContent();
  }
}
