import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import type { SimulateQuoteRequest } from '@barat/contracts';

import { zodPipe } from '../../common/pipes/zod-validation.pipe';
import { Roles } from '../identity/rbac/roles.decorator';
import type { ActorRequest } from '../identity/identity.tokens';
import {
  PricingRuleService,
  putPricingRuleRequestSchema,
  toWirePricingRule,
  type PutPricingRuleRequest,
  type PricingRuleActor,
} from './pricing-rule.service';
import { SimulatorService } from './simulator.service';
import { simulateQuoteRequestSchema } from '@barat/contracts';

/**
 * `?includeHistory=true` opts into superseded versions. Anything else means
 * false: an unrecognised value must not be read as "yes, show me everything".
 */
export const pricingRulesQuerySchema = z.object({
  includeHistory: z
    .string()
    .optional()
    .default('false')
    .transform((value) => value === 'true'),
});

type PricingRulesQuery = z.infer<typeof pricingRulesQuerySchema>;

/**
 * Deactivation carries the version the operator believed they were looking at.
 *
 * It is validated rather than read off an untyped body: an absent or
 * string-typed `expectedVersion` would compare unequal to the stored number and
 * surface as a version conflict, which sends finance hunting for a concurrent
 * editor who does not exist.
 */
const deactivatePricingRuleRequestSchema = z.object({
  expectedVersion: z.number().int().min(1),
});

type DeactivatePricingRuleRequest = z.infer<typeof deactivatePricingRuleRequestSchema>;

/**
 * Pricing administration and the quote simulator.
 *
 * The route prefix is `pricing`; the Foundation bootstrap adds `/api`, so the
 * public paths are `/api/pricing/rules` and `/api/pricing/simulate`.
 *
 * `@Roles` is intentionally on every mutating/read administration route. The
 * identity workstream's global RolesGuard resolves a current staff role from a
 * verified session; a role in a body, query string or client-side UI has no
 * authorisation value.
 */
@Controller('pricing')
export class PricingController {
  /* Tokens named explicitly: see FxController — it keeps the DI edge visible. */
  constructor(
    @Inject(PricingRuleService) private readonly pricingRuleService: PricingRuleService,
    @Inject(SimulatorService) private readonly simulatorService: SimulatorService,
  ) {}

  @Get('rules')
  @Roles('ADMIN', 'FINANCE')
  async listRules(
    @Query(zodPipe(pricingRulesQuerySchema)) query: PricingRulesQuery,
  ) {
    const rules = await this.pricingRuleService.list({ includeHistory: query.includeHistory });
    return rules.map(toWirePricingRule);
  }

  @Put('rules')
  @Roles('ADMIN', 'FINANCE')
  async replaceRule(
    @Body(zodPipe(putPricingRuleRequestSchema)) body: PutPricingRuleRequest,
    @Req() request: ActorRequest,
  ) {
    const rule = await this.pricingRuleService.put(body, actorFromRequest(request));
    return toWirePricingRule(rule);
  }

  /**
   * Deactivation is a versioned replacement, not a physical delete. This is
   * useful for operations but does not change the economic immutability rule.
   */
  @Put('rules/:id/deactivate')
  @Roles('ADMIN', 'FINANCE')
  async deactivateRule(
    @Param('id') id: string,
    @Body(zodPipe(deactivatePricingRuleRequestSchema)) body: DeactivatePricingRuleRequest,
    @Req() request: ActorRequest,
  ) {
    const rule = await this.pricingRuleService.deactivate(
      id,
      body.expectedVersion,
      actorFromRequest(request),
    );
    return toWirePricingRule(rule);
  }

  /** Run the exact same pure computation used by customer quote creation. */
  @Post('simulate')
  @Roles('ADMIN', 'FINANCE')
  async simulate(
    @Body(zodPipe(simulateQuoteRequestSchema)) body: SimulateQuoteRequest,
  ) {
    return this.simulatorService.simulate(body);
  }
}

function actorFromRequest(request: ActorRequest): PricingRuleActor {
  const actor = request.actor;
  const staffId = actor?.type === 'STAFF' ? actor.staffId : null;
  const headers = request.headers;
  const userAgent = headers['user-agent'];
  const requestId = headers['x-request-id'];

  return {
    staffId,
    auditActor: staffId ?? 'unknown-staff',
    role: actor?.type === 'STAFF' ? actor.role : null,
    ip: request.ip ?? request.socket?.remoteAddress ?? null,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
    requestId: typeof requestId === 'string' ? requestId.slice(0, 128) : null,
  };
}
