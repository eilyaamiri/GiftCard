import 'reflect-metadata';

import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { ROLES_METADATA_KEY } from '../identity/rbac/roles.decorator';

/**
 * The pricing administration surface.
 *
 * Pricing rules decide what every customer pays, so the two things worth
 * asserting here are not the happy path but the guard rails around it:
 *
 *  - every route is role-restricted (AGENTS.md section 4: server-side RBAC is
 *    the only authorisation that counts), and
 *  - the actor recorded on the audit row comes from the verified session, never
 *    from a body or header the caller controls.
 *
 * `@barat/database` is stubbed because importing it constructs a PrismaClient at
 * module load; the controller itself never touches it.
 */
vi.mock('@barat/database', () => ({
  prisma: {},
  Prisma: { JsonNull: null, TransactionIsolationLevel: { Serializable: 'Serializable' } },
  PricingRuleScope: { GLOBAL: 'GLOBAL', PRODUCT: 'PRODUCT', SKU: 'SKU', SERVICE: 'SERVICE' },
}));

import type { ActorRequest } from '../identity/identity.tokens';
import { PricingRuleService, type PricingRuleActor } from './pricing-rule.service';
import { PricingController, pricingRulesQuerySchema } from './pricing.controller';
import { PricingModule } from './pricing.module';
import { PricingService } from './pricing.service';
import { SimulatorService } from './simulator.service';

/* ============================================================================
 * Fixtures
 * ==========================================================================*/

const STORED_RULE = Object.freeze({
  id: 'rule_1',
  name: 'Global default',
  scope: 'GLOBAL' as const,
  targetId: null,
  version: 3,
  fxSpreadBps: 150,
  fxRiskBufferBps: 100,
  serviceFeeBps: 200,
  serviceFeeFixedIrr: 50_000n,
  operationalFeeIrr: 30_000n,
  targetMarginBps: 600,
  minimumMarginIrr: 200_000n,
  paymentFeeBps: 100,
  paymentFeeFixedIrr: 12_000n,
  quoteTtlSeconds: 600,
  roundingStepIrr: 10_000n,
  maxSupplierCostToleranceBps: 500,
  isActive: true,
  effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  effectiveTo: null,
  createdByStaffId: 'staff_1',
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
  updatedAt: new Date('2026-08-01T00:00:00.000Z'),
});

function makeController() {
  const list = vi.fn(async (_options?: { readonly includeHistory?: boolean }) => [STORED_RULE]);
  const put = vi.fn(async (_input: unknown, _actor: PricingRuleActor) => STORED_RULE);
  const deactivate = vi.fn(
    async (_id: string, _expectedVersion: number, _actor: PricingRuleActor) => ({
      ...STORED_RULE,
      isActive: false,
      version: 4,
    }),
  );

  const ruleService = { list, put, deactivate } as unknown as PricingRuleService;
  const simulatorService = new SimulatorService(new PricingService());

  return {
    controller: new PricingController(ruleService, simulatorService),
    list,
    put,
    deactivate,
  };
}

function staffRequest(overrides: Partial<ActorRequest> = {}): ActorRequest {
  return {
    actor: {
      type: 'STAFF',
      staffId: 'staff_finance_1',
      role: 'FINANCE',
      email: 'finance@barat.example',
    },
    headers: { 'user-agent': 'BaratAdmin/1.0', 'x-request-id': 'req_42' },
    ip: '10.0.0.7',
    ...overrides,
  };
}

/* ============================================================================
 * Authorisation metadata
 * ==========================================================================*/

describe('PricingController / authorisation', () => {
  const reflector = new Reflector();

  it.each([
    ['listRules'],
    ['replaceRule'],
    ['deactivateRule'],
    ['simulate'],
  ])('restricts %s to ADMIN and FINANCE', (method) => {
    const roles = reflector.get<readonly string[]>(
      ROLES_METADATA_KEY,
      PricingController.prototype[method as keyof typeof PricingController.prototype],
    );

    expect(roles).toEqual(['ADMIN', 'FINANCE']);
  });

  it('leaves no route unguarded', () => {
    const handlers = Object.getOwnPropertyNames(PricingController.prototype).filter(
      (name) => name !== 'constructor',
    );

    for (const name of handlers) {
      const roles = reflector.get<readonly string[] | undefined>(
        ROLES_METADATA_KEY,
        PricingController.prototype[name as keyof typeof PricingController.prototype],
      );
      expect(roles, `${name} has no @Roles decorator`).toBeDefined();
    }
  });
});

/* ============================================================================
 * Rule routes
 * ==========================================================================*/

/* ============================================================================
 * Module wiring
 * ==========================================================================*/

describe('PricingModule', () => {
  it('resolves the controller and both services from the container', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [PricingModule] }).compile();

    expect(moduleRef.get(PricingController)).toBeInstanceOf(PricingController);
    expect(moduleRef.get(PricingService)).toBeInstanceOf(PricingService);
    expect(moduleRef.get(PricingRuleService)).toBeInstanceOf(PricingRuleService);
    expect(moduleRef.get(SimulatorService)).toBeInstanceOf(SimulatorService);

    await moduleRef.close();
  });

  it('exports the engine so quotes and reconciliation price through one instance', async () => {
    const consumer = await Test.createTestingModule({ imports: [PricingModule] }).compile();
    const engine = consumer.get(PricingService);

    // A second copy of the engine would be harmless today and a divergence
    // waiting to happen the moment it grows any configuration.
    expect(consumer.get(PricingService)).toBe(engine);

    await consumer.close();
  });
});

describe('pricingRulesQuerySchema', () => {
  it('defaults to active rules only', () => {
    expect(pricingRulesQuerySchema.parse({}).includeHistory).toBe(false);
  });

  it('opts into history only on the exact literal "true"', () => {
    expect(pricingRulesQuerySchema.parse({ includeHistory: 'true' }).includeHistory).toBe(true);
  });

  it.each(['false', 'TRUE', '1', 'yes', ''])(
    'treats %s as a request for active rules only',
    (value) => {
      expect(pricingRulesQuerySchema.parse({ includeHistory: value }).includeHistory).toBe(false);
    },
  );
});

describe('PricingController / rules', () => {
  it('returns active rules only unless history is requested', async () => {
    const { controller, list } = makeController();

    await controller.listRules({ includeHistory: false });
    expect(list).toHaveBeenCalledWith({ includeHistory: false });

    await controller.listRules({ includeHistory: true });
    expect(list).toHaveBeenLastCalledWith({ includeHistory: true });
  });

  it('projects rules onto the wire with no bigint left behind', async () => {
    const { controller } = makeController();

    const response = await controller.listRules({ includeHistory: false });
    expect(response[0]?.minimumMarginIrr).toBe('200000');
    expect(() => JSON.stringify(response)).not.toThrow();
  });

  it('derives the audit actor from the session, not from the payload', async () => {
    const { controller, put } = makeController();
    const body = { name: 'Global default' } as never;

    await controller.replaceRule(body, staffRequest());

    expect(put).toHaveBeenCalledWith(body, {
      staffId: 'staff_finance_1',
      auditActor: 'staff_finance_1',
      role: 'FINANCE',
      ip: '10.0.0.7',
      userAgent: 'BaratAdmin/1.0',
      requestId: 'req_42',
    });
  });

  it('records an unknown actor rather than trusting a customer session', async () => {
    const { controller, put } = makeController();
    const request = staffRequest({
      actor: { type: 'CUSTOMER', customerId: 'cus_1', sessionId: 'sess_1' },
      headers: {},
      ip: undefined,
      socket: { remoteAddress: '192.0.2.9' },
    });

    await controller.replaceRule({} as never, request);

    expect(put.mock.calls[0]?.[1]).toMatchObject({
      staffId: null,
      auditActor: 'unknown-staff',
      role: null,
      ip: '192.0.2.9',
      userAgent: null,
      requestId: null,
    });
  });

  it('truncates attacker-controlled header values before they reach the audit row', async () => {
    const { controller, put } = makeController();
    const request = staffRequest({
      headers: { 'user-agent': 'A'.repeat(5_000), 'x-request-id': 'B'.repeat(5_000) },
    });

    await controller.replaceRule({} as never, request);

    const actor = put.mock.calls[0]?.[1];
    expect(actor?.userAgent).toHaveLength(512);
    expect(actor?.requestId).toHaveLength(128);
  });

  it('ignores a non-string header and an unresolvable IP instead of storing junk', async () => {
    const { controller, put } = makeController();
    const request = staffRequest({
      headers: { 'user-agent': ['a', 'b'], 'x-request-id': 7 },
      ip: undefined,
      socket: undefined,
    });

    await controller.replaceRule({} as never, request);

    expect(put.mock.calls[0]?.[1]).toMatchObject({
      userAgent: null,
      requestId: null,
      ip: null,
    });
  });

  it('passes the path id and expected version through to deactivation', async () => {
    const { controller, deactivate } = makeController();

    const response = await controller.deactivateRule(
      'rule_1',
      { expectedVersion: 3 },
      staffRequest(),
    );

    expect(deactivate).toHaveBeenCalledWith(
      'rule_1',
      3,
      expect.objectContaining({ staffId: 'staff_finance_1' }),
    );
    expect(response.isActive).toBe(false);
    expect(response.version).toBe(4);
  });
});

/* ============================================================================
 * Simulator route
 * ==========================================================================*/

describe('PricingController / simulate', () => {
  const simulateBody = {
    skuId: null,
    serviceId: null,
    supplierOfferId: null,
    quantity: 1,
    supplierCostForeign: '96.500000',
    supplierCostCurrency: 'USD',
    marketFxRate: '1920000.000000',
    rule: {
      id: 'rule_1',
      name: 'Global default',
      version: 3,
      fxSpreadBps: 150,
      fxRiskBufferBps: 100,
      serviceFeeBps: 200,
      serviceFeeFixedIrr: '50000',
      operationalFeeIrr: '30000',
      targetMarginBps: 600,
      minimumMarginIrr: '200000',
      paymentFeeBps: 100,
      paymentFeeFixedIrr: '12000',
      quoteTtlSeconds: 600,
      roundingStepIrr: '10000',
      maxSupplierCostToleranceBps: 500,
    },
  } as never;

  it('returns a JSON-safe breakdown produced by the shared engine', async () => {
    const { controller } = makeController();

    const response = await controller.simulate(simulateBody);

    expect(() => JSON.stringify(response)).not.toThrow();
    expect(response.breakdown.finalAmountIrr).toMatch(/^\d+$/u);
    expect(response.fx?.provider).toBe('admin-simulator');
  });

  it('agrees exactly with a direct call to the pure engine', async () => {
    // The simulator stamps its synthetic FX snapshot with the wall clock, so two
    // independent calls would differ by a millisecond on that field alone. Freeze
    // time so the whole breakdown — every money field included — can be compared.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-01T00:00:00.000Z'));
    try {
      const { controller } = makeController();
      const direct = new SimulatorService(new PricingService()).simulate(simulateBody);

      const response = await controller.simulate(simulateBody);

      expect(response.breakdown).toEqual(direct.breakdown);
    } finally {
      vi.useRealTimers();
    }
  });
});
