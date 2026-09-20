/* eslint-disable @typescript-eslint/consistent-type-imports -- SupportChannelsService is
 * constructor-injected. With `emitDecoratorMetadata`, a type-only import erases the
 * class and Nest cannot resolve it at runtime. */
import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../identity';
import {
  SupportChannelsService,
  type PublicSupportChannelDto,
} from './support-channels.service';

/**
 * The contact options the storefront shows, for anyone.
 *
 * Public because the contact sheet is reachable from every page, including
 * before a visitor has an account. Nothing here is customer-specific: it is the
 * same list of published support routes for every caller.
 */
@ApiTags('support-channels')
@Controller('support/channels')
export class SupportChannelsController {
  constructor(private readonly channels: SupportChannelsService) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'List the support channels currently offered to customers' })
  list(): Promise<{ items: readonly PublicSupportChannelDto[] }> {
    return this.channels.listPublic();
  }
}
