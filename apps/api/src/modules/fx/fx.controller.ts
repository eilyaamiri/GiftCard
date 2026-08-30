import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FxProviderHealth, FxRateSnapshot, GetFxRateResponse } from '@barat/contracts';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { FxAggregatorService } from './fx-aggregator.service';
import type { FxHistoryResult } from './fx.types';
import {
  fxCurrentQuerySchema,
  fxHistoryQuerySchema,
  fxOverrideDeleteQuerySchema,
  fxOverrideRequestSchema,
  type FxCurrentQuery,
  type FxHistoryQuery,
  type FxOverrideDeleteQuery,
  type FxOverrideRequest,
} from './fx.dto';
import { FxOverrideGuard, requireStaffActor } from './fx-staff.guard';

@ApiTags('fx')
@Controller('fx')
export class FxController {
  /*
   * The token is named explicitly. With `emitDecoratorMetadata` a plain
   * constructor type annotation also works, but it makes the class import look
   * type-only to the linter and hides the fact that this is a DI token.
   */
  constructor(@Inject(FxAggregatorService) private readonly aggregator: FxAggregatorService) {}

  @Get('current')
  @ApiOperation({ summary: 'Current selected FX rate with provider health' })
  @ApiOkResponse({ description: 'Snapshot plus safe provider health summaries' })
  async current(
    @Query(zodPipe(fxCurrentQuerySchema)) query: FxCurrentQuery,
  ): Promise<GetFxRateResponse> {
    return this.aggregator.getCurrent(query.pair);
  }

  /**
   * `current` returns 503 when nothing usable exists — which is correct, but it
   * leaves an operator with no way to see WHY. This endpoint always answers, so
   * the admin dashboard can show which provider is down during an outage.
   */
  @Get('health')
  @ApiOperation({ summary: 'FX provider health, available even when no rate is usable' })
  @ApiOkResponse({ description: 'Normalised provider health summaries' })
  async health(): Promise<{ providers: FxProviderHealth[] }> {
    const providers = await this.aggregator.getProviderHealth();
    return { providers: [...providers] };
  }

  @Get('history')
  @ApiOperation({ summary: 'Paginated FX rate history, manual rows included' })
  @ApiOkResponse({ description: 'Persisted rate observations, newest first' })
  async history(
    @Query(zodPipe(fxHistoryQuerySchema)) query: FxHistoryQuery,
  ): Promise<FxHistoryResult> {
    return this.aggregator.getHistory(query.pair, query.page, query.pageSize);
  }

  /**
   * ADMIN and FINANCE only. Every override is audited with the staff actor from
   * the authenticated session — the request body never names the actor.
   */
  @Post('override')
  @UseGuards(FxOverrideGuard)
  @ApiOperation({ summary: 'Pin a manual FX rate (ADMIN/FINANCE, audited)' })
  @ApiOkResponse({ description: 'The persisted override snapshot' })
  async setOverride(
    @Body(zodPipe(fxOverrideRequestSchema)) body: FxOverrideRequest,
    @Req() request: unknown,
  ): Promise<FxRateSnapshot> {
    const actor = requireStaffActor(request as Record<string, unknown>);
    return this.aggregator.setManualOverride(
      {
        pair: body.pair,
        buyRate: body.buyRate,
        sellRate: body.sellRate,
        midRate: body.midRate,
        reason: body.reason,
        ttlSeconds: body.ttlSeconds,
      },
      actor,
    );
  }

  @Delete('override')
  @UseGuards(FxOverrideGuard)
  @ApiOperation({ summary: 'Expire the active manual FX override (ADMIN/FINANCE, audited)' })
  @ApiOkResponse({ description: 'Number of override rows expired' })
  async clearOverride(
    @Query(zodPipe(fxOverrideDeleteQuerySchema)) query: FxOverrideDeleteQuery,
    @Req() request: unknown,
  ): Promise<{ expired: number }> {
    const actor = requireStaffActor(request as Record<string, unknown>);
    return this.aggregator.clearManualOverride(query.pair, actor);
  }
}
