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
import {
  STAFF_ROLE_VALUES,
  type FxProviderHealth,
  type FxRateSnapshot,
  type GetFxRateResponse,
  type StaffRole,
} from '@barat/contracts';

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
import { Roles } from '../identity/rbac/roles.decorator';
import { FX_OVERRIDE_ROLES, FxOverrideGuard, requireStaffActor } from './fx-staff.guard';

/** Every staff role may read the rate. Customers and anonymous callers may not. */
export const FX_READ_ROLES: readonly StaffRole[] = STAFF_ROLE_VALUES;

@ApiTags('fx')
@Controller('fx')
export class FxController {
  /*
   * The token is named explicitly. With `emitDecoratorMetadata` a plain
   * constructor type annotation also works, but it makes the class import look
   * type-only to the linter and hides the fact that this is a DI token.
   */
  constructor(@Inject(FxAggregatorService) private readonly aggregator: FxAggregatorService) {}

  /*
   * The three read routes are staff-only. Only the admin panel calls them, and
   * it forwards the staff session. Left public, `current` let any anonymous
   * caller trigger live venue calls plus an FxRate insert per request (and a
   * Telegram alert during an outage). Enough of that traffic uses up the
   * venue's rate limit, after which every customer quote fails as stale.
   * `history` also exposed override reasons. Every staff role may still read.
   */
  @Get('current')
  @Roles(...FX_READ_ROLES)
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
  @Roles(...FX_READ_ROLES)
  @ApiOperation({ summary: 'FX provider health, available even when no rate is usable' })
  @ApiOkResponse({ description: 'Normalised provider health summaries' })
  async health(): Promise<{ providers: FxProviderHealth[] }> {
    const providers = await this.aggregator.getProviderHealth();
    return { providers: [...providers] };
  }

  @Get('history')
  @Roles(...FX_READ_ROLES)
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
  @Roles(...FX_OVERRIDE_ROLES)
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
  @Roles(...FX_OVERRIDE_ROLES)
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
