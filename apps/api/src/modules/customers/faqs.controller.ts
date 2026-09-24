/* eslint-disable @typescript-eslint/consistent-type-imports -- FaqsService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../identity';
import { FaqsService, type PublicFaqDto } from './faqs.service';

/**
 * The FAQ section the storefront renders, for anyone.
 *
 * Public because the landing page and `/help` both show it before a visitor
 * has an account. Only published entries are returned, already in display order.
 */
@ApiTags('faqs')
@Controller('faqs')
export class FaqsController {
  constructor(private readonly faqs: FaqsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List the FAQ entries currently published to customers' })
  list(): Promise<{ items: readonly PublicFaqDto[] }> {
    return this.faqs.listPublic();
  }
}
