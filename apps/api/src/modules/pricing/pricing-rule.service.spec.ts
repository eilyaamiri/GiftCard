import { ConflictException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PricingRuleService,
  putPricingRuleRequestSchema,
  toEnginePricingRule,
  toWirePricingRule,
} from './pricing-rule.service';

/**
 * Versioned PricingRule persistence.
 *
 * A pricing rule is the configuration that decides what every customer pays.
 * The invariant these tests defend is not "the CRUD works" — it is that an
 * economic field on an existing version can NEVER change. A historical order
 * must be re-priceable from its snapshot years later, which is only true if the
 * row that priced it is still byte-for-byte what it was (AGENTS.md rules 4, 11).
 *
 * `@barat/database` is mocked wholesale rather than pointed at a test database:
 * importing it for real constructs a `PrismaClient` at module load and demands
 * `DATABASE_URL`, which would make a pure unit test depend on a running
 * Postgres. The stub below models the two behaviours the service actually
 * relies on — `$transaction` atomicity and the `@@unique([scope, targetId,
 * version])` constraint — and nothing else.
 */

interface StoredRule {
  id: string;
  name: string;
  scope: 'GLOBAL' | 'PRODUCT' | 'SKU' | 'SERVICE';
  targetId: string | null;
  version: number;
  fxSpreadBps: number;
  fxRiskBufferBps: number;
  serviceFeeBps: number;
  serviceFeeFixedIrr: bigint;
  operationalFeeIrr: bigint;
  targetMarginBps: number;
  minimumMarginIrr: bigint;
  paymentFeeBps: number;
  paymentFeeFixedIrr: bigint;
  quoteTtlSeconds: number;
  roundingStepIrr: bigint;
  maxSupplierCostToleranceBps: number;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdByStaffId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredAuditLog {
  id: string;
  actor: string;
  actorType: string;
  actorRole: string | null;
  action: string;
  entity: string;
  entityId: string;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

/**
 * Everything the mock factory touches must be created inside `vi.hoisted`: the
 * factory runs during module resolution, before any top-level `const` in this
 * file has been initialised.
 */
const database = vi.hoisted(() => {
  const JSON_NULL = Symbol('Prisma.JsonNull');

  const state = {
    rules: [] as unknown[],
    auditLogs: [] as unknown[],
    /** Number of `$transaction` calls that should fail before one succeeds. */
    failuresRemaining: 0,
    /** The error thrown while `failuresRemaining > 0`. */
    failureError: undefined as unknown,
    transactionCalls: 0,
    /** Set when a create violated the unique constraint, for assertions. */
    lastCreateRejection: null as unknown,
  };

  let sequence = 0;
  const nextId = (prefix: string): string => {
    sequence += 1;
    return `${prefix}_${String(sequence).padStart(4, '0')}`;
  };

  type AnyRule = Record<string, unknown>;

  const matches = (rule: AnyRule, where: Record<string, unknown> | undefined): boolean => {
    if (where === undefined) {
      return true;
    }
    return Object.entries(where).every(([key, value]) => rule[key] === value);
  };

  const sortRules = (rules: AnyRule[]): AnyRule[] =>
    [...rules].sort((left, right) => {
      const scopeOrder = String(left['scope']).localeCompare(String(right['scope']));
      if (scopeOrder !== 0) {
        return scopeOrder;
      }
      const targetOrder = String(left['targetId'] ?? '').localeCompare(
        String(right['targetId'] ?? ''),
      );
      if (targetOrder !== 0) {
        return targetOrder;
      }
      return Number(right['version']) - Number(left['version']);
    });

  const client = {
    pricingRule: {
      findMany: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        sortRules((state.rules as AnyRule[]).filter((rule) => matches(rule, where))),

      findUnique: async ({ where }: { where: { id: string } }) =>
        (state.rules as AnyRule[]).find((rule) => rule['id'] === where.id) ?? null,

      findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) =>
        sortRules((state.rules as AnyRule[]).filter((rule) => matches(rule, where)))[0] ?? null,

      updateMany: async ({
        where,
        data,
      }: {
        where?: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        let count = 0;
        for (const rule of state.rules as AnyRule[]) {
          if (matches(rule, where)) {
            Object.assign(rule, data);
            count += 1;
          }
        }
        return { count };
      },

      create: async ({ data }: { data: Record<string, unknown> }) => {
        // Model @@unique([scope, targetId, version]) faithfully: the service's
        // retry path only makes sense if this can actually reject.
        const duplicate = (state.rules as AnyRule[]).some(
          (rule) =>
            rule['scope'] === data['scope'] &&
            rule['targetId'] === data['targetId'] &&
            rule['version'] === data['version'],
        );
        if (duplicate) {
          const error = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
          state.lastCreateRejection = error;
          throw error;
        }

        const now = new Date('2026-08-30T12:00:00.000Z');
        const created = {
          id: nextId('rule'),
          targetId: null,
          version: 1,
          isActive: true,
          effectiveFrom: now,
          effectiveTo: null,
          createdByStaffId: null,
          createdAt: now,
          updatedAt: now,
          ...data,
        };
        state.rules.push(created);
        return created;
      },
    },

    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const created = {
          id: nextId('audit'),
          createdAt: new Date('2026-08-30T12:00:00.000Z'),
          ...data,
        };
        state.auditLogs.push(created);
        return created;
      },
    },

    /**
     * A transaction that really is atomic for our purposes: the row arrays are
     * snapshotted and restored on failure, so a rolled-back attempt cannot leave
     * a half-written version behind for the next retry to trip over.
     */
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      state.transactionCalls += 1;

      const rulesSnapshot = (state.rules as AnyRule[]).map((rule) => ({ ...rule }));
      const auditSnapshot = [...state.auditLogs];

      if (state.failuresRemaining > 0) {
        state.failuresRemaining -= 1;
        throw state.failureError;
      }

      try {
        return await fn(client);
      } catch (error) {
        state.rules = rulesSnapshot;
        state.auditLogs = auditSnapshot;
        throw error;
      }
    },
  };

  return { state, client, JSON_NULL };
});

vi.mock('@barat/database', () => ({
  prisma: database.client,
  Prisma: {
    JsonNull: database.JSON_NULL,
    TransactionIsolationLevel: { Serializable: 'Serializable' },
  },
  PricingRuleScope: {
    GLOBAL: 'GLOBAL',
    PRODUCT: 'PRODUCT',
    SKU: 'SKU',
    SERVICE: 'SERVICE',
  },
}));

type PutRequest = ReturnType<typeof putPricingRuleRequestSchema.parse>;

/* ============================================================================
 * Fixtures
 * ==========================================================================*/

const ACTOR = Object.freeze({
  staffId: 'staff_finance_1',
  auditActor: 'staff_finance_1',
  role: 'FINANCE',
  requestId: 'req_1',
  ip: '10.0.0.7',
  userAgent: 'BaratAdmin/1.0',
});

function putRequest(overrides: Record<string, unknown> = {}): PutRequest {
  return putPricingRuleRequestSchema.parse({
    name: 'Global default',
    scope: 'GLOBAL',
    targetId: null,
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
    ...overrides,
  });
}

function rules(): StoredRule[] {
  return database.state.rules as StoredRule[];
}

function auditLogs(): StoredAuditLog[] {
  return database.state.auditLogs as StoredAuditLog[];
}

let service: PricingRuleService;

beforeEach(() => {
  database.state.rules = [];
  database.state.auditLogs = [];
  database.state.failuresRemaining = 0;
  database.state.failureError = undefined;
  database.state.transactionCalls = 0;
  database.state.lastCreateRejection = null;
  service = new PricingRuleService();
});

/* ============================================================================
 * Versioning — the immutability invariant
 * ==========================================================================*/

describe('PricingRuleService.put / versioning', () => {
  it('creates version 1 when no rule exists for the scope', async () => {
    const created = await service.put(putRequest(), ACTOR);

    expect(created.version).toBe(1);
    expect(created.isActive).toBe(true);
    expect(created.effectiveTo).toBeNull();
    expect(rules()).toHaveLength(1);
  });

  it('inserts a NEW version instead of mutating the existing row', async () => {
    const first = await service.put(putRequest(), ACTOR);
    const second = await service.put(
      putRequest({ targetMarginBps: 900, expectedVersion: 1 }),
      ACTOR,
    );

    expect(second.id).not.toBe(first.id);
    expect(second.version).toBe(2);
    expect(rules()).toHaveLength(2);

    // The row that priced yesterday's orders still says 600 bps.
    const original = rules().find((rule) => rule.id === first.id);
    expect(original?.targetMarginBps).toBe(600);
    expect(original?.version).toBe(1);
  });

  it('deactivates the previous version and stamps its effectiveTo', async () => {
    const first = await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ expectedVersion: 1 }), ACTOR);

    const original = rules().find((rule) => rule.id === first.id);
    expect(original?.isActive).toBe(false);
    expect(original?.effectiveTo).toBeInstanceOf(Date);
  });

  it('leaves exactly one active version per scope/target chain', async () => {
    await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ expectedVersion: 1 }), ACTOR);
    await service.put(putRequest({ expectedVersion: 2 }), ACTOR);

    expect(rules().filter((rule) => rule.isActive)).toHaveLength(1);
    expect(rules().filter((rule) => rule.isActive)[0]?.version).toBe(3);
  });

  it('versions each scope/target chain independently', async () => {
    await service.put(putRequest(), ACTOR);
    const skuRule = await service.put(
      putRequest({ scope: 'SKU', targetId: 'sku_apple_10', name: 'Apple 10 USD' }),
      ACTOR,
    );

    expect(skuRule.version).toBe(1);
    expect(rules().filter((rule) => rule.isActive)).toHaveLength(2);
  });

  it('converts every IRR field to an exact bigint, never a float', async () => {
    const created = await service.put(
      putRequest({ minimumMarginIrr: '9007199254740993' }),
      ACTOR,
    );

    // 2^53 + 1 — the first integer a JS number cannot represent.
    expect(created.minimumMarginIrr).toBe(9_007_199_254_740_993n);
    expect(typeof created.minimumMarginIrr).toBe('bigint');
  });

  it('records the creating staff member, and omits it for a system actor', async () => {
    const withStaff = await service.put(putRequest(), ACTOR);
    expect(withStaff.createdByStaffId).toBe('staff_finance_1');

    const systemActor = { ...ACTOR, staffId: null, auditActor: 'system:seed' };
    const withoutStaff = await service.put(
      putRequest({ scope: 'SKU', targetId: 'sku_x' }),
      systemActor,
    );
    expect(withoutStaff.createdByStaffId).toBeNull();
  });
});

/* ============================================================================
 * Optimistic concurrency
 * ==========================================================================*/

describe('PricingRuleService.put / optimistic concurrency', () => {
  it('requires expectedVersion once a rule exists', async () => {
    await service.put(putRequest(), ACTOR);

    await expect(service.put(putRequest(), ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(rules()).toHaveLength(1);
  });

  it('rejects a stale expectedVersion — the lost-update case', async () => {
    await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ expectedVersion: 1 }), ACTOR);

    // Two finance users opened the editor on v1; the second one saves last.
    await expect(
      service.put(putRequest({ targetMarginBps: 1200, expectedVersion: 1 }), ACTOR),
    ).rejects.toThrow(/expected 1, current 2/u);
    expect(rules()).toHaveLength(2);
  });

  it('rejects expectedVersion on a chain that does not exist yet', async () => {
    await expect(service.put(putRequest({ expectedVersion: 1 }), ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(rules()).toHaveLength(0);
  });

  it('rolls back the audit log when the write is rejected', async () => {
    await service.put(putRequest(), ACTOR);
    const auditCountAfterCreate = auditLogs().length;

    await expect(service.put(putRequest(), ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(auditLogs()).toHaveLength(auditCountAfterCreate);
  });

  it('retries a serialisation failure and then succeeds', async () => {
    database.state.failuresRemaining = 2;
    database.state.failureError = Object.assign(new Error('write conflict'), { code: 'P2034' });

    const created = await service.put(putRequest(), ACTOR);

    expect(created.version).toBe(1);
    expect(database.state.transactionCalls).toBe(3);
  });

  it('retries a unique-version race and then succeeds on the next transaction', async () => {
    database.state.failuresRemaining = 1;
    database.state.failureError = Object.assign(new Error('concurrent version insert'), {
      code: 'P2002',
    });

    const created = await service.put(putRequest(), ACTOR);

    expect(created.version).toBe(1);
    expect(database.state.transactionCalls).toBe(2);
  });

  it('gives up after the third attempt rather than looping forever', async () => {
    database.state.failuresRemaining = 3;
    database.state.failureError = Object.assign(new Error('write conflict'), { code: 'P2034' });

    await expect(service.put(putRequest(), ACTOR)).rejects.toThrow('write conflict');
    expect(database.state.transactionCalls).toBe(3);
  });

  it('does not retry an error that is not a transaction conflict', async () => {
    database.state.failuresRemaining = 1;
    database.state.failureError = new Error('column does not exist');

    await expect(service.put(putRequest(), ACTOR)).rejects.toThrow('column does not exist');
    expect(database.state.transactionCalls).toBe(1);
  });

  it('refuses to increment a version that cannot be represented exactly', async () => {
    const created = await service.put(putRequest(), ACTOR);
    // A corrupted or hand-edited row: one more increment would land on a value
    // JS cannot distinguish from its neighbour, silently colliding two versions.
    (rules().find((rule) => rule.id === created.id) as StoredRule).version =
      Number.MAX_SAFE_INTEGER;

    await expect(
      service.put(putRequest({ expectedVersion: Number.MAX_SAFE_INTEGER }), ACTOR),
    ).rejects.toThrow(/cannot be incremented safely/u);
    expect(rules()).toHaveLength(1);
  });

  it('does not retry a plain non-object rejection', async () => {
    database.state.failuresRemaining = 1;
    database.state.failureError = 'boom';

    await expect(service.put(putRequest(), ACTOR)).rejects.toBe('boom');
    expect(database.state.transactionCalls).toBe(1);
  });
});

/* ============================================================================
 * Audit trail
 * ==========================================================================*/

describe('PricingRuleService.put / audit', () => {
  it('writes a CREATED entry with a null before-image', async () => {
    const created = await service.put(putRequest(), ACTOR);

    expect(auditLogs()).toHaveLength(1);
    const entry = auditLogs()[0];
    expect(entry?.action).toBe('PRICING_RULE_CREATED');
    expect(entry?.entity).toBe('PricingRule');
    expect(entry?.entityId).toBe(created.id);
    expect(entry?.before).toBe(database.JSON_NULL);
  });

  it('writes an UPDATED entry carrying both the old and new economics', async () => {
    await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ targetMarginBps: 900, expectedVersion: 1 }), ACTOR);

    const entry = auditLogs()[1];
    expect(entry?.action).toBe('PRICING_RULE_UPDATED');
    expect(entry?.before).toMatchObject({ version: 1, targetMarginBps: 600 });
    expect(entry?.after).toMatchObject({ version: 2, targetMarginBps: 900 });
  });

  it('serialises every bigint in the snapshot as a string', async () => {
    await service.put(putRequest(), ACTOR);

    const after = auditLogs()[0]?.after as Record<string, unknown>;
    expect(after['minimumMarginIrr']).toBe('200000');
    expect(after['roundingStepIrr']).toBe('10000');
    // A raw bigint here would make the whole audit row unserialisable.
    expect(() => JSON.stringify(after)).not.toThrow();
  });

  it('attributes the change to the requesting staff member and request', async () => {
    await service.put(putRequest(), ACTOR);

    expect(auditLogs()[0]).toMatchObject({
      actor: 'staff_finance_1',
      actorType: 'STAFF',
      actorRole: 'FINANCE',
      ip: '10.0.0.7',
      userAgent: 'BaratAdmin/1.0',
      requestId: 'req_1',
    });
  });

  it('tolerates an actor with no request metadata', async () => {
    await service.put(putRequest(), { staffId: null, auditActor: 'system:seed', role: null });

    expect(auditLogs()[0]).toMatchObject({
      actor: 'system:seed',
      actorRole: null,
      ip: null,
      userAgent: null,
      requestId: null,
    });
  });
});

/* ============================================================================
 * Read paths
 * ==========================================================================*/

describe('PricingRuleService.list / get', () => {
  it('returns only active rules by default', async () => {
    await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ expectedVersion: 1 }), ACTOR);

    const active = await service.list();
    expect(active).toHaveLength(1);
    expect(active[0]?.version).toBe(2);
  });

  it('returns the full history when asked', async () => {
    await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ expectedVersion: 1 }), ACTOR);

    const history = await service.list({ includeHistory: true });
    expect(history.map((rule) => rule.version)).toEqual([2, 1]);
  });

  it('fetches a single rule by id', async () => {
    const created = await service.put(putRequest(), ACTOR);
    await expect(service.get(created.id)).resolves.toMatchObject({ id: created.id });
  });

  it('throws NotFound rather than returning null for an unknown id', async () => {
    await expect(service.get('rule_missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});

/* ============================================================================
 * Deactivation
 * ==========================================================================*/

describe('PricingRuleService.deactivate', () => {
  it('appends an inactive copy instead of deleting the financial record', async () => {
    const created = await service.put(putRequest(), ACTOR);
    const deactivated = await service.deactivate(created.id, 1, ACTOR);

    expect(deactivated.version).toBe(2);
    expect(deactivated.isActive).toBe(false);
    expect(deactivated.effectiveTo).toBeInstanceOf(Date);
    expect(rules()).toHaveLength(2);
    // Nothing was removed — rule 6 of the data model.
    expect(rules().some((rule) => rule.id === created.id)).toBe(true);
  });

  it('copies the economics forward verbatim so the history stays replayable', async () => {
    const created = await service.put(putRequest(), ACTOR);
    const deactivated = await service.deactivate(created.id, 1, ACTOR);

    expect(deactivated.targetMarginBps).toBe(created.targetMarginBps);
    expect(deactivated.minimumMarginIrr).toBe(created.minimumMarginIrr);
    expect(deactivated.roundingStepIrr).toBe(created.roundingStepIrr);
  });

  it('leaves no active version behind', async () => {
    const created = await service.put(putRequest(), ACTOR);
    await service.deactivate(created.id, 1, ACTOR);

    await expect(service.list()).resolves.toHaveLength(0);
  });

  it('rejects a stale expectedVersion', async () => {
    const created = await service.put(putRequest(), ACTOR);
    await expect(service.deactivate(created.id, 7, ACTOR)).rejects.toThrow(
      /expected 7, current 1/u,
    );
    expect(rules()).toHaveLength(1);
  });

  it('rejects deactivating a superseded version', async () => {
    const first = await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ expectedVersion: 1 }), ACTOR);

    // v1 is no longer the head of the chain; deactivating it would resurrect
    // stale economics as the newest version.
    await expect(service.deactivate(first.id, 1, ACTOR)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('throws NotFound for an unknown id', async () => {
    await expect(service.deactivate('rule_missing', 1, ACTOR)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/* ============================================================================
 * Request validation
 * ==========================================================================*/

describe('putPricingRuleRequestSchema', () => {
  it('requires a null targetId on a GLOBAL rule', () => {
    const result = putPricingRuleRequestSchema.safeParse({
      ...putRequest(),
      scope: 'GLOBAL',
      targetId: 'sku_1',
    });
    expect(result.success).toBe(false);
  });

  it('requires a targetId on a scoped rule', () => {
    const result = putPricingRuleRequestSchema.safeParse({
      ...putRequest(),
      scope: 'SKU',
      targetId: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects a zero rounding step, which would divide by zero downstream', () => {
    const result = putPricingRuleRequestSchema.safeParse({
      ...putRequest(),
      roundingStepIrr: '0',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a sub-Toman rounding step before it becomes an unusable active rule', () => {
    const result = putPricingRuleRequestSchema.safeParse({
      ...putRequest(),
      roundingStepIrr: '11',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a negative fee expressed as an IRR string', () => {
    const result = putPricingRuleRequestSchema.safeParse({
      ...putRequest(),
      serviceFeeFixedIrr: '-1',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a fractional bps value', () => {
    const result = putPricingRuleRequestSchema.safeParse({ ...putRequest(), serviceFeeBps: 12.5 });
    expect(result.success).toBe(false);
  });

  it('defaults isActive to true', () => {
    const parsed = putPricingRuleRequestSchema.parse({
      ...putRequest(),
      isActive: undefined,
    });
    expect(parsed.isActive).toBe(true);
  });
});

/* ============================================================================
 * Projections
 * ==========================================================================*/

describe('rule projections', () => {
  it('toEnginePricingRule keeps IRR as bigint and freezes the result', async () => {
    const created = await service.put(putRequest(), ACTOR);
    const engineRule = toEnginePricingRule(created);

    expect(engineRule.minimumMarginIrr).toBe(200_000n);
    expect(engineRule.roundingStepIrr).toBe(10_000n);
    expect(Object.isFrozen(engineRule)).toBe(true);
    // The engine must not see persistence metadata it could branch on.
    expect(engineRule).not.toHaveProperty('isActive');
  });

  it('toWirePricingRule stringifies every bigint and every date', async () => {
    const created = await service.put(putRequest(), ACTOR);
    const wire = toWirePricingRule(created);

    expect(wire.minimumMarginIrr).toBe('200000');
    expect(wire.paymentFeeFixedIrr).toBe('12000');
    expect(wire.effectiveFrom).toBe(created.effectiveFrom.toISOString());
    expect(wire.effectiveTo).toBeNull();
    expect(() => JSON.stringify(wire)).not.toThrow();
  });

  it('toWirePricingRule renders a closed version window', async () => {
    const created = await service.put(putRequest(), ACTOR);
    await service.put(putRequest({ expectedVersion: 1 }), ACTOR);

    const superseded = rules().find((rule) => rule.id === created.id);
    const wire = toWirePricingRule(superseded as never);
    expect(wire.isActive).toBe(false);
    expect(typeof wire.effectiveTo).toBe('string');
  });
});
