import { beforeEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import {
  acceptQuoteResponseSchema,
  createQuoteResponseSchema,
  type CreateQuoteRequest,
  type DecimalString,
  type FxRateSnapshot,
  type IrrString,
} from '@barat/contracts';

/**
 * `@barat/database` constructs the shared PrismaClient at module load, so any
 * file that imports it for a runtime value drags `DATABASE_URL` — and a real
 * PostgreSQL — into a pure unit test. `QuotesService` itself no longer does,
 * but it reaches `toEnginePricingRule` through `pricing-rule.service`, which
 * does. Stubbing the module keeps these tests hermetic; the quote flow under
 * test talks to the database only through the injected `QUOTES_DATABASE` port,
 * which the fake below supplies.
 */
vi.mock('@barat/database', () => ({
  prisma: {},
  Prisma: { JsonNull: null, TransactionIsolationLevel: { Serializable: 'Serializable' } },
  PricingRuleScope: { GLOBAL: 'GLOBAL', PRODUCT: 'PRODUCT', SKU: 'SKU', SERVICE: 'SERVICE' },
}));

import type { AuditService } from '../audit/audit.service';
import type { CatalogService } from '../catalog/catalog.service';
import type { PricingRuleService } from '../pricing/pricing-rule.service';
import { PricingService } from '../pricing/pricing.service';
import type { QuotesDatabase } from './quote.ports';
import { QuotesService, type QuoteActor } from './quotes.service';

/* ============================================================================
 * Fixtures
 *
 * The pricing engine is the REAL one: these tests are about the quote
 * lifecycle, and stubbing the arithmetic would let a snapshot look immutable
 * while carrying numbers nothing ever produced.
 *
 * Supplier identity and supplier cost are deliberately given values that would
 * be obvious if they ever surfaced in a customer response.
 * ==========================================================================*/

const SUPPLIER_ID = 'supplier-tillo-secret';
const OFFER_ID = 'offer-secret-42';
/** What we pay the supplier per unit. Never customer-visible. */
const SUPPLIER_COST_USD = '46.512345';
/** What the customer is buying. Public information. */
const FACE_VALUE_USD = '50';

const CREATED_AT = new Date('2026-08-30T10:00:00.000Z');

const SKU_TARGET = {
  sku: {
    id: 'sku-1',
    productId: 'product-1',
    code: 'APPLE-US-50',
    region: 'US',
    currency: 'USD',
    faceValue: new Decimal(FACE_VALUE_USD),
    denominationLabel: '$50',
    deliveryAssetType: 'CODE',
    isActive: true,
    minQuantity: 1,
    maxQuantity: 10,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
  offerId: OFFER_ID,
  supplierId: SUPPLIER_ID,
  costCurrency: 'USD',
  listedCost: SUPPLIER_COST_USD,
  discountBps: 0,
  effectiveCost: SUPPLIER_COST_USD,
};

const GLOBAL_RULE = {
  id: 'rule-global-1',
  name: 'global v1',
  scope: 'GLOBAL',
  targetId: null,
  version: 1,
  fxSpreadBps: 150,
  fxRiskBufferBps: 50,
  serviceFeeBps: 200,
  serviceFeeFixedIrr: 0n,
  operationalFeeIrr: 50_000n,
  targetMarginBps: 500,
  minimumMarginIrr: 100_000n,
  paymentFeeBps: 100,
  paymentFeeFixedIrr: 0n,
  quoteTtlSeconds: 600,
  roundingStepIrr: 10_000n,
  maxSupplierCostToleranceBps: 500,
  isActive: true,
  effectiveFrom: CREATED_AT,
  effectiveTo: null,
  createdByStaffId: null,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
};

function fxSnapshot(midRate = '920000'): FxRateSnapshot {
  return {
    id: 'fx-1',
    pair: 'USD_IRR',
    buyRate: midRate,
    sellRate: midRate,
    midRate,
    provider: 'primary-nav',
    source: 'API',
    receivedAt: '2026-08-30T09:59:30.000Z',
    effectiveAt: '2026-08-30T09:59:30.000Z',
    expiresAt: null,
    isManualOverride: false,
    overrideReason: null,
    ageSeconds: 30,
    isStale: false,
  } as FxRateSnapshot;
}

function createRequest(overrides: Partial<CreateQuoteRequest> = {}): CreateQuoteRequest {
  return { skuId: 'sku-1', quantity: 1, currency: 'USD', ...overrides } as CreateQuoteRequest;
}

/* ============================================================================
 * A minimal in-memory stand-in for the two tables quotes owns
 *
 * It implements only the operations `QuotesService` actually issues, including
 * the CONDITIONAL `updateMany` that is the concurrency fence for acceptance —
 * a fake that ignored the `where` clause would make every idempotency test
 * pass for the wrong reason.
 * ==========================================================================*/

type Row = Record<string, any>;

class FakeQuoteDatabase {
  readonly rows = new Map<string, Row>();
  readonly componentRows = new Map<string, Row[]>();
  private sequence = 0;

  readonly quote = {
    create: async ({ data }: { data: Row }): Promise<Row> => {
      const id = typeof data['id'] === 'string' ? data['id'] : `quote-${(this.sequence += 1)}`;
      const row: Row = {
        id,
        acceptedAt: null,
        cancelledAt: null,
        idempotencyKey: null,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
        ...data,
        /* Prisma hands Decimal columns back as Decimal, not as the string we
         * wrote. Mimicking that is what exercises the DTO's decimal handling. */
        marketFxRate: new Decimal(data['marketFxRate']),
        effectiveFxRate: new Decimal(data['effectiveFxRate']),
        supplierCostUsd: new Decimal(data['supplierCostUsd']),
      };
      this.rows.set(id, row);
      this.componentRows.set(id, []);
      return { ...row };
    },

    findUnique: async (args: { where: Row; include?: unknown }): Promise<Row | null> => {
      const row = this.locate(args.where);
      return row ? this.project(row, args.include !== undefined) : null;
    },

    findUniqueOrThrow: async (args: { where: Row; include?: unknown }): Promise<Row> => {
      const row = await this.quote.findUnique(args);
      if (!row) {
        throw new Error('Quote not found');
      }
      return row;
    },

    updateMany: async ({ where, data }: { where: Row; data: Row }): Promise<{ count: number }> => {
      let count = 0;
      for (const row of this.rows.values()) {
        if (matches(row, where)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  readonly quoteComponent = {
    createMany: async ({ data }: { data: readonly Row[] }): Promise<{ count: number }> => {
      for (const component of data) {
        const bucket = this.componentRows.get(component['quoteId'] as string) ?? [];
        bucket.push({
          ...component,
          amountForeign:
            component['amountForeign'] == null ? null : new Decimal(component['amountForeign']),
        });
        this.componentRows.set(component['quoteId'] as string, bucket);
      }
      return { count: data.length };
    },
  };

  readonly commerceSession = {
    upsert: async (): Promise<{ id: string }> => ({ id: 'session-row-1' }),
  };

  $transaction = async <T>(callback: (tx: unknown) => Promise<T>): Promise<T> => callback(this);

  /** The single stored row, for assertions about what was persisted. */
  only(): Row {
    const [row] = [...this.rows.values()];
    if (!row) {
      throw new Error('No quote was persisted');
    }
    return row;
  }

  componentsOf(id: string): Row[] {
    return this.componentRows.get(id) ?? [];
  }

  private locate(where: Row): Row | undefined {
    if (typeof where['id'] === 'string') {
      return this.rows.get(where['id']);
    }
    if (typeof where['idempotencyKey'] === 'string') {
      return [...this.rows.values()].find(
        (row) => row['idempotencyKey'] === where['idempotencyKey'],
      );
    }
    return undefined;
  }

  private project(row: Row, withComponents: boolean): Row {
    const components = [...(this.componentRows.get(row['id'] as string) ?? [])].sort(
      (left, right) => (left['sortOrder'] as number) - (right['sortOrder'] as number),
    );
    return withComponents ? { ...row, components } : { ...row };
  }
}

/** Supports exactly the `where` shapes `QuotesService` builds. */
function matches(row: Row, where: Row): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const actual = row[key];
    if (expected === null) {
      if (actual != null) return false;
      continue;
    }
    if (expected instanceof Date || typeof expected !== 'object') {
      if (
        actual !== expected &&
        !(actual instanceof Date && actual.getTime() === (expected as Date).getTime?.())
      ) {
        return false;
      }
      continue;
    }
    const bound = expected as { gt?: Date; lte?: Date };
    if (bound.gt !== undefined && !(actual > bound.gt)) return false;
    if (bound.lte !== undefined && !(actual <= bound.lte)) return false;
  }
  return true;
}

/* ============================================================================
 * Harness
 * ==========================================================================*/

interface Harness {
  readonly service: QuotesService;
  readonly db: FakeQuoteDatabase;
  readonly record: ReturnType<typeof vi.fn>;
  readonly computeQuote: ReturnType<typeof vi.fn>;
  readonly getRateSnapshot: ReturnType<typeof vi.fn>;
  readonly getServiceForQuote: ReturnType<typeof vi.fn>;
  readonly rules: { value: unknown[] };
}

const ACTOR: QuoteActor = { customerId: 'customer-1', commerceSessionId: null };

function harness(): Harness {
  const db = new FakeQuoteDatabase();
  const engine = new PricingService();
  const computeQuote = vi.fn(engine.computeQuote.bind(engine));
  const pricing = {
    computeQuote,
    toWirePricingBreakdown: engine.toWirePricingBreakdown.bind(engine),
  };

  const getRateSnapshot = vi.fn(async () => fxSnapshot());
  const rules = { value: [GLOBAL_RULE] as unknown[] };
  const pricingRules = { list: async () => rules.value } as unknown as PricingRuleService;
  const getServiceForQuote = vi.fn();
  const catalog = {
    getSkuQuoteTarget: vi.fn(async () => SKU_TARGET),
    getServiceForQuote,
  } as unknown as CatalogService;

  const record = vi.fn().mockResolvedValue(undefined);

  const service = new QuotesService(
    db as unknown as QuotesDatabase,
    catalog,
    pricingRules,
    pricing as never,
    { getRateSnapshot } as never,
    { record } as unknown as AuditService,
  );

  return {
    service,
    db,
    record,
    computeQuote,
    getRateSnapshot,
    getServiceForQuote,
    rules,
  };
}

function actionsOf(record: ReturnType<typeof vi.fn>): string[] {
  return record.mock.calls.map((call) => (call[0] as { action: string }).action);
}

/* ============================================================================
 * Tests
 * ==========================================================================*/

describe('QuotesService.createQuote', () => {
  let context: Harness;

  beforeEach(() => {
    context = harness();
  });

  it('persists a full immutable snapshot rather than references', async () => {
    const response = await context.service.createQuote(createRequest(), ACTOR);

    const row = context.db.only();
    const snapshot = row['snapshot'] as Record<string, unknown>;

    /* Everything needed to explain the price months later, by VALUE. */
    expect(snapshot['id']).toBe(row['id']);
    expect(snapshot['quoteNumber']).toBe(row['quoteNumber']);
    expect(snapshot['rule']).toMatchObject({
      id: GLOBAL_RULE.id,
      version: 1,
      fxSpreadBps: 150,
      fxRiskBufferBps: 50,
      targetMarginBps: 500,
      roundingStepIrr: '10000',
      quoteTtlSeconds: 600,
    });
    expect(snapshot['fx']).toMatchObject({ midRate: '920000', provider: 'primary-nav' });
    expect(snapshot['target']).toMatchObject({
      kind: 'SKU',
      supplierOffer: {
        id: OFFER_ID,
        supplierId: SUPPLIER_ID,
        listedCost: SUPPLIER_COST_USD,
        discountBps: 0,
        effectiveCost: SUPPLIER_COST_USD,
      },
    });
    expect(snapshot['finalAmountIrr']).toBe(row['finalAmountIrr'].toString());
    expect(snapshot['effectiveFxRate']).toBe(row['effectiveFxRate'].toFixed(6));
    expect(Array.isArray(snapshot['components'])).toBe(true);

    /* And one auditable QuoteComponent row per line of the calculation. */
    const components = context.db.componentsOf(row['id'] as string);
    expect(components.length).toBeGreaterThan(0);
    expect(components.map((component) => component['kind'])).toContain('SUPPLIER_COST');
    for (const component of components) {
      expect(typeof component['amountIrr']).toBe('bigint');
    }

    expect(response.quote.finalAmountIrr).toBe(row['finalAmountIrr'].toString());
  });

  it('snapshots an international service and its field definitions by value', async () => {
    const serviceField = {
      id: 'field-1',
      serviceId: 'service-1',
      key: 'accountEmail',
      label: 'Account email',
      labelFa: 'ایمیل حساب',
      fieldType: 'EMAIL',
      isRequired: true,
      validationRegex: null,
      helpTextFa: 'ایمیل مقصد را وارد کنید',
      options: null,
      sortOrder: 0,
    };
    context.getServiceForQuote.mockResolvedValue({
      id: 'service-1',
      slug: 'international-payment',
      name: 'International payment',
      nameFa: 'پرداخت بین‌المللی',
      category: 'payment',
      currency: 'USD',
      minAmount: new Decimal('1'),
      maxAmount: new Decimal('1000'),
      isActive: true,
      requiresManualReview: true,
      sortOrder: 0,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      fields: [serviceField],
    });

    await context.service.createQuote(
      createRequest({
        skuId: undefined,
        serviceId: 'service-1',
        requestedAmountForeign: '25' as DecimalString,
        serviceFields: { accountEmail: 'buyer@example.com' },
      }),
      ACTOR,
    );

    const target = (context.db.only()['snapshot'] as Record<string, unknown>)['target'] as Record<
      string,
      unknown
    >;
    expect(target).toMatchObject({
      kind: 'SERVICE',
      service: {
        id: 'service-1',
        minAmount: '1.000000',
        maxAmount: '1000.000000',
        fields: [
          {
            key: 'accountEmail',
            labelFa: 'ایمیل حساب',
            fieldType: 'EMAIL',
            isRequired: true,
          },
        ],
      },
    });

    serviceField.labelFa = 'changed after quote creation';
    expect(target).toMatchObject({
      service: { fields: [{ labelFa: 'ایمیل حساب' }] },
    });
  });

  it('produces a contract-valid response', async () => {
    const response = await context.service.createQuote(createRequest(), ACTOR);
    expect(() => createQuoteResponseSchema.parse(response)).not.toThrow();
  });

  it('sets expiresAt to now + rule.quoteTtlSeconds and reports the countdown', async () => {
    const response = await context.service.createQuote(createRequest(), ACTOR);

    const row = context.db.only();
    const ttlMs = (row['expiresAt'] as Date).getTime() - (row['createdAt'] as Date).getTime();
    /* createdAt is the fixture clock, so compare against the response instead. */
    expect(response.quote.remainingSeconds).toBeGreaterThan(590);
    expect(response.quote.remainingSeconds).toBeLessThanOrEqual(600);
    expect(row['status']).toBe('ACTIVE');
    expect(Number.isFinite(ttlMs)).toBe(true);
  });

  it('never exposes supplier identity or supplier cost to the customer', async () => {
    const response = await context.service.createQuote(createRequest({ quantity: 2 }), ACTOR);
    const serialised = JSON.stringify(response);

    expect(response.quote.supplierOfferId).toBeNull();
    expect(response.quote.pricingRuleId).toBeNull();
    expect(response.quote.rule).toBeNull();
    expect(response.quote.fxRateId).toBeNull();
    expect(response.quote.fxProvider).toBe('barat');
    /* Spread, buffer and margin are the pricing policy, not the customer's business. */
    expect(response.quote.fxSpreadAmount).toBe('0');
    expect(response.quote.fxRiskBufferAmount).toBe('0');
    expect(response.quote.marginAmount).toBe('0');
    expect(response.quote.marketFxRate).toBe(response.quote.effectiveFxRate);
    /* `supplierCostUsd` carries the face value the customer is buying. */
    expect(response.quote.supplierCostUsd).toBe('100');

    for (const secret of [
      SUPPLIER_ID,
      OFFER_ID,
      SUPPLIER_COST_USD,
      'primary-nav',
      GLOBAL_RULE.id,
    ]) {
      expect(serialised).not.toContain(secret);
    }
    for (const component of response.quote.components) {
      expect(component.bps).toBeNull();
    }
    /* The persisted row still holds all of it — audit is not the same audience. */
    expect(context.db.only()['supplierOfferId']).toBe(OFFER_ID);
  });

  it('refuses to price against a stale FX rate', async () => {
    context.getRateSnapshot.mockResolvedValue({
      ...fxSnapshot(),
      isStale: true,
      ageSeconds: 9_000,
    });

    await expect(context.service.createQuote(createRequest(), ACTOR)).rejects.toMatchObject({
      code: 'FX_RATE_STALE',
    });
    expect(context.db.rows.size).toBe(0);
  });

  it('refuses a quote with no owner at all', async () => {
    await expect(context.service.createQuote(createRequest(), {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('refuses a quantity outside the SKU limits', async () => {
    await expect(
      context.service.createQuote(createRequest({ quantity: 99 }), ACTOR),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('refuses when no pricing rule matches', async () => {
    context.rules.value = [];
    await expect(context.service.createQuote(createRequest(), ACTOR)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('QuotesService.getQuote', () => {
  it('never re-prices: the stored snapshot survives an FX and a rule change', async () => {
    const context = harness();
    const created = await context.service.createQuote(createRequest(), ACTOR);
    expect(context.computeQuote).toHaveBeenCalledTimes(1);

    /* The market moves and the rule is edited after the quote was issued. */
    context.getRateSnapshot.mockResolvedValue(fxSnapshot('1150000'));
    context.rules.value = [{ ...GLOBAL_RULE, targetMarginBps: 9_000, version: 2 }];

    const read = await context.service.getQuote(created.quote.id, ACTOR);

    expect(read.quote.finalAmountIrr).toBe(created.quote.finalAmountIrr);
    expect(read.quote.effectiveFxRate).toBe(created.quote.effectiveFxRate);
    expect(read.quote.components).toEqual(created.quote.components);
    expect(context.computeQuote).toHaveBeenCalledTimes(1);
    expect(context.getRateSnapshot).toHaveBeenCalledTimes(1);
  });

  it("reports another caller's quote as missing rather than forbidden", async () => {
    const context = harness();
    const created = await context.service.createQuote(createRequest(), ACTOR);

    await expect(
      context.service.getQuote(created.quote.id, { customerId: 'customer-2' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });

    /* An anonymous session token does not unlock a quote bound to a customer. */
    await expect(
      context.service.getQuote(created.quote.id, { commerceSessionId: 'session-row-1' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('QuotesService.acceptQuote', () => {
  let context: Harness;
  let quoteId: string;
  let amount: IrrString;

  beforeEach(async () => {
    context = harness();
    const created = await context.service.createQuote(createRequest(), ACTOR);
    quoteId = created.quote.id;
    amount = created.quote.finalAmountIrr;
  });

  function accept(overrides: Record<string, unknown> = {}) {
    return context.service.acceptQuote(
      {
        quoteId,
        idempotencyKey: 'idem-accept-0123456789',
        acknowledgedAmountIrr: amount,
        ...overrides,
      } as never,
      ACTOR,
    );
  }

  it('accepts an ACTIVE quote once and records the transition', async () => {
    const response = await accept();

    expect(response.accepted).toBe(true);
    expect(response.quote.status).toBe('ACCEPTED');
    expect(context.db.only()['status']).toBe('ACCEPTED');
    expect(context.db.only()['acceptedAt']).toBeInstanceOf(Date);
    expect(actionsOf(context.record)).toEqual(['QUOTE_CREATED', 'QUOTE_ACCEPTED']);
    expect(() => acceptQuoteResponseSchema.parse(response)).not.toThrow();
  });

  it('is idempotent: replaying the key returns the same quote without re-accepting', async () => {
    const first = await accept();
    const second = await accept();
    const third = await accept();

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(false);
    expect(third.accepted).toBe(false);
    expect(second.quote.id).toBe(first.quote.id);
    expect(second.quote.finalAmountIrr).toBe(first.quote.finalAmountIrr);
    expect(second.quote.acceptedAt).toBe(first.quote.acceptedAt);
    /* Exactly one acceptance in the audit trail, however many replays arrive. */
    expect(actionsOf(context.record).filter((action) => action === 'QUOTE_ACCEPTED')).toHaveLength(
      1,
    );
    /* And no re-pricing on any replay. */
    expect(context.computeQuote).toHaveBeenCalledTimes(1);
  });

  it('refuses a key that was already used for a different quote', async () => {
    await accept();
    const other = await context.service.createQuote(createRequest(), ACTOR);

    await expect(
      context.service.acceptQuote(
        {
          quoteId: other.quote.id,
          idempotencyKey: 'idem-accept-0123456789',
          acknowledgedAmountIrr: other.quote.finalAmountIrr,
        } as never,
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('refuses a second acceptance under a different key', async () => {
    await accept();

    await expect(accept({ idempotencyKey: 'idem-accept-9876543210' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('rejects an expired quote, marks it EXPIRED and never re-prices it', async () => {
    context.db.only()['expiresAt'] = new Date(Date.now() - 1_000);

    await expect(accept()).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });

    expect(context.db.only()['status']).toBe('EXPIRED');
    expect(context.db.only()['acceptedAt']).toBeNull();
    expect(context.db.only()['idempotencyKey']).toBeNull();
    expect(context.computeQuote).toHaveBeenCalledTimes(1);
    expect(actionsOf(context.record)).toEqual(['QUOTE_CREATED']);

    /* A retry with the same key must not resurrect it either. */
    await expect(accept()).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
  });

  it('refuses and audits an acknowledged amount that differs from the snapshot', async () => {
    await expect(accept({ acknowledgedAmountIrr: '1' })).rejects.toMatchObject({
      code: 'AMOUNT_MISMATCH',
    });

    expect(context.db.only()['status']).toBe('ACTIVE');
    expect(context.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'QUOTE_AMOUNT_MISMATCH',
        entity: 'Quote',
        after: { acknowledgedAmountIrr: '1' },
      }),
    );
  });

  it("refuses to accept another caller's quote", async () => {
    await expect(
      context.service.acceptQuote(
        {
          quoteId,
          idempotencyKey: 'idem-accept-0123456789',
          acknowledgedAmountIrr: amount,
        } as never,
        { customerId: 'customer-2' },
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('QuotesService.expireQuotes', () => {
  it('marks only ACTIVE quotes whose expiry has passed', async () => {
    const context = harness();
    const stale = await context.service.createQuote(createRequest(), ACTOR);
    const fresh = await context.service.createQuote(createRequest(), ACTOR);

    context.db.rows.get(stale.quote.id)!['expiresAt'] = new Date(Date.now() - 60_000);

    expect(await context.service.expireQuotes()).toBe(1);
    expect(context.db.rows.get(stale.quote.id)!['status']).toBe('EXPIRED');
    expect(context.db.rows.get(fresh.quote.id)!['status']).toBe('ACTIVE');

    /* Running it again is a no-op, so a scheduler may call it freely. */
    expect(await context.service.expireQuotes()).toBe(0);
  });

  it('leaves an already ACCEPTED quote alone', async () => {
    const context = harness();
    const created = await context.service.createQuote(createRequest(), ACTOR);
    await context.service.acceptQuote(
      {
        quoteId: created.quote.id,
        idempotencyKey: 'idem-accept-0123456789',
        acknowledgedAmountIrr: created.quote.finalAmountIrr,
      } as never,
      ACTOR,
    );

    context.db.only()['expiresAt'] = new Date(Date.now() - 60_000);

    expect(await context.service.expireQuotes()).toBe(0);
    expect(context.db.only()['status']).toBe('ACCEPTED');
  });
});
