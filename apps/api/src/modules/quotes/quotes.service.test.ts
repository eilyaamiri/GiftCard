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

import { open } from '../../common/crypto/aead-envelope';
import type { AuditService } from '../audit/audit.service';
import type { CatalogService } from '../catalog/catalog.service';
import { CrossRateUnavailableError, type CrossRateSnapshot } from '../fx/cross-rate.types';
import { toEnginePricingRule, type PricingRuleService } from '../pricing/pricing-rule.service';
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

/** The envelope key the config stub hands out, and the AAD that binds it. */
const ACCOUNT_KEY = Buffer.alloc(32, 7);
const ACCOUNT_PASSWORD_AAD = 'barat-pay:service-account-password:v1';

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

/**
 * The same card as `SKU_TARGET` but denominated in pounds, which is the shape
 * the false out-of-stock and the mispricing both turned on: the face value is
 * GBP while the supplier still invoices us in dollars.
 */
const GBP_SKU_TARGET = {
  ...SKU_TARGET,
  sku: {
    ...SKU_TARGET.sku,
    id: 'sku-gbp-1',
    code: 'APPLE-GB-25',
    region: 'GB',
    currency: 'GBP',
    faceValue: new Decimal('25'),
    denominationLabel: '£25',
  },
  /* What Reloadly actually bills for a £25 card — dollars, and not 25 of them. */
  costCurrency: 'USD',
  listedCost: '33.44',
  effectiveCost: '33.44',
};

/** Live quotes from 2026-09-23; one dollar buys this many units. */
const CROSS_TABLE: Readonly<Record<string, string>> = {
  GBP: '0.74756',
  EUR: '0.84896',
  JPY: '157.39',
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

function crossRate(
  currency: string,
  overrides: Partial<CrossRateSnapshot> = {},
): CrossRateSnapshot {
  if (currency === 'USD') {
    return {
      currency: 'USD',
      unitsPerUsd: '1',
      provider: 'identity',
      source: 'IDENTITY',
      publishedOn: null,
      receivedAt: '2026-08-30T09:00:00.000Z',
      ageSeconds: 0,
      isStale: false,
      isIdentity: true,
      ...overrides,
    };
  }
  const unitsPerUsd = CROSS_TABLE[currency];
  if (unitsPerUsd === undefined) {
    throw new CrossRateUnavailableError(currency, 'UNSUPPORTED_CURRENCY');
  }
  return {
    currency,
    unitsPerUsd,
    provider: 'frankfurter',
    source: 'API',
    publishedOn: '2026-08-30',
    receivedAt: '2026-08-30T09:00:00.000Z',
    ageSeconds: 3_600,
    isStale: false,
    isIdentity: false,
    ...overrides,
  };
}

function createRequest(overrides: Partial<CreateQuoteRequest> = {}): CreateQuoteRequest {
  return { skuId: 'sku-1', quantity: 1, currency: 'USD', ...overrides } as CreateQuoteRequest;
}

/** A top-up offer, as `CatalogService.getTopUpOfferForQuote` resolves one. */
function topUpTarget(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    offer: {
      id: 'topup-offer-1',
      gameId: 'topup-game-1',
      providerOfferId: 'stars-500',
      name: '500 Stars',
      nameFa: '۵۰۰ استارز',
      costAmount: new Decimal('4.75'),
      costCurrency: 'USD',
      isActive: true,
      isListed: true,
      sortOrder: 0,
      lastSyncedAt: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    game: {
      id: 'topup-game-1',
      slug: 'telegram-stars',
      supplierId: SUPPLIER_ID,
      providerCategoryId: 'telegram',
      name: 'Telegram Stars',
      nameFa: 'استارز تلگرام',
      brandName: 'Telegram',
      region: 'GLOBAL',
      imageUrl: null,
      providerNote: null,
      descriptionFa: null,
      isActive: true,
      isListed: true,
      requiresCredentials: false,
      sortOrder: 0,
      lastSyncedAt: null,
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    },
    supplierId: SUPPLIER_ID,
    supplierCode: 'fazercards',
    costCurrency: 'USD',
    costAmount: '4.750000',
    providerSku: 'telegram:stars:500',
    fields: [
      {
        id: 'field-1',
        gameId: 'topup-game-1',
        key: 'telegram_username',
        label: 'Telegram username',
        labelFa: 'نام کاربری تلگرام',
        fieldType: 'TEXT',
        isRequired: true,
        options: null,
        validationRegex: '^[A-Za-z][A-Za-z0-9_]{3,31}$',
        helpTextFa: null,
        sortOrder: 0,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    ...overrides,
  };
}

/** A `TOP_UP_GAME` rule at the product owner's 5%, administered not hardcoded. */
const TOP_UP_RULE = {
  ...GLOBAL_RULE,
  id: 'rule-topup-1',
  name: 'top-up 5%',
  scope: 'TOP_UP_GAME',
  /* Matched by the GAME id, not by a denomination's offer id: the scope exists
   * to price all Stars/Premium offers for one game under one rule. */
  targetId: 'topup-game-1',
  targetMarginBps: 500,
};

/**
 * The seed's `TOP_UP_GAME` rule: no target, so it prices every game that has no
 * rule of its own. A distinct margin keeps it tell-apart from both neighbours.
 */
const TOP_UP_FALLBACK_RULE = {
  ...GLOBAL_RULE,
  id: 'rule-topup-fallback',
  name: 'top-up fallback 5%',
  scope: 'TOP_UP_GAME',
  targetId: null,
  targetMarginBps: 450,
};

/** An international service with no configured fields of its own. */
function serviceForQuote(): Record<string, unknown> {
  return {
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
    fields: [],
  };
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
  readonly getCrossRate: ReturnType<typeof vi.fn>;
  readonly getSkuQuoteTarget: ReturnType<typeof vi.fn>;
  readonly getFromPriceCandidates: ReturnType<typeof vi.fn>;
  readonly getServiceForQuote: ReturnType<typeof vi.fn>;
  readonly getTopUpOfferForQuote: ReturnType<typeof vi.fn>;
  readonly getLivePrice: ReturnType<typeof vi.fn>;
  readonly rules: { value: unknown[] };
}

const ACTOR: QuoteActor = { customerId: 'customer-1', commerceSessionId: null };

function harness(
  options: {
    readonly skuTarget?: unknown;
    readonly topUpTarget?: unknown;
    readonly liveTopUpPrice?: unknown | null;
    readonly fromPriceCandidates?: readonly unknown[];
  } = {},
): Harness {
  const db = new FakeQuoteDatabase();
  const engine = new PricingService();
  const computeQuote = vi.fn(engine.computeQuote.bind(engine));
  const pricing = {
    computeQuote,
    toWirePricingBreakdown: engine.toWirePricingBreakdown.bind(engine),
  };

  const getRateSnapshot = vi.fn(async () => fxSnapshot());
  const getCrossRate = vi.fn(async (currency: string) => crossRate(currency));
  const rules = { value: [GLOBAL_RULE] as unknown[] };
  const pricingRules = { list: async () => rules.value } as unknown as PricingRuleService;
  const getServiceForQuote = vi.fn();
  const getSkuQuoteTarget = vi.fn(async () => options.skuTarget ?? SKU_TARGET);
  const getFromPriceCandidates = vi.fn(async () => options.fromPriceCandidates ?? []);
  const getTopUpOfferForQuote = vi.fn(async () => options.topUpTarget ?? topUpTarget());
  const getLivePrice = vi.fn(async () =>
    options.liveTopUpPrice === undefined
      ? {
          providerSku: 'telegram:stars:500',
          cost: { amount: '4.750000', currency: 'USD' },
          observedAt: new Date('2026-08-30T09:59:45.000Z'),
        }
      : options.liveTopUpPrice,
  );
  const catalog = {
    getSkuQuoteTarget,
    getFromPriceCandidates,
    getServiceForQuote,
    getTopUpOfferForQuote,
  } as unknown as CatalogService;

  const record = vi.fn().mockResolvedValue(undefined);

  const service = new QuotesService(
    db as unknown as QuotesDatabase,
    catalog,
    pricingRules,
    pricing as never,
    { getRateSnapshot } as never,
    { getSnapshot: getCrossRate } as never,
    { getLivePrice } as never,
    { record } as unknown as AuditService,
    /* A fresh buffer per call, like the real config: the service zeroes the key
     * it is handed once the password envelope exists. */
    { bankDetailsEncryptionKey: () => Buffer.from(ACCOUNT_KEY) } as never,
  );

  return {
    service,
    db,
    record,
    computeQuote,
    getRateSnapshot,
    getCrossRate,
    getSkuQuoteTarget,
    getFromPriceCandidates,
    getServiceForQuote,
    getTopUpOfferForQuote,
    getLivePrice,
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
        serviceFields: { accountEmail: 'buyer@example.com', siteUrl: 'https://openai.com/pricing' },
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

  it('requires the site address on an international service quote', async () => {
    context.getServiceForQuote.mockResolvedValue(serviceForQuote());

    const error = await context.service
      .createQuote(
        createRequest({
          skuId: undefined,
          serviceId: 'service-1',
          requestedAmountForeign: '25' as DecimalString,
          serviceFields: {},
        }),
        ACTOR,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(JSON.stringify(error)).toContain('serviceFields.siteUrl');
    expect(context.db.rows.size).toBe(0);
  });

  it('rejects a site address that is not an http(s) URL', async () => {
    context.getServiceForQuote.mockResolvedValue(serviceForQuote());

    const error = await context.service
      .createQuote(
        createRequest({
          skuId: undefined,
          serviceId: 'service-1',
          requestedAmountForeign: '25' as DecimalString,
          serviceFields: { siteUrl: 'javascript:alert(1)' },
        }),
        ACTOR,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(context.db.rows.size).toBe(0);
  });

  it('seals the account password and keeps it out of the readable snapshot', async () => {
    context.getServiceForQuote.mockResolvedValue(serviceForQuote());

    await context.service.createQuote(
      createRequest({
        skuId: undefined,
        serviceId: 'service-1',
        requestedAmountForeign: '25' as DecimalString,
        serviceFields: {
          siteUrl: 'https://openai.com/pricing',
          accountUsername: 'buyer@example.com',
          accountPassword: 'hunter2-not-in-the-clear',
        },
      }),
      ACTOR,
    );

    const snapshot = context.db.only()['snapshot'] as Record<string, unknown>;
    const account = snapshot['serviceAccount'] as Record<string, unknown>;

    expect(account['siteUrl']).toBe('https://openai.com/pricing');
    expect(account['accountUsername']).toBe('buyer@example.com');

    /* The password exists only as ciphertext, bound to its own AAD... */
    const envelope = account['accountPasswordEnvelope'] as string;
    expect(envelope.startsWith('v1.')).toBe(true);
    expect(open(envelope, Buffer.from(ACCOUNT_KEY), ACCOUNT_PASSWORD_AAD)).toBe(
      'hunter2-not-in-the-clear',
    );

    /* ...and appears nowhere else in the row, including `serviceFields`. */
    expect(
      JSON.stringify(context.db.only(), (_key, value: unknown) =>
        typeof value === 'bigint' ? value.toString() : value,
      ),
    ).not.toContain('hunter2-not-in-the-clear');
    /* The three account keys are stripped out of the readable field bag, so a
     * consumer that renders configured fields cannot render a credential. */
    expect(snapshot['serviceFields']).toEqual({});
  });

  it('refuses a password with no username to go with it', async () => {
    context.getServiceForQuote.mockResolvedValue(serviceForQuote());

    const error = await context.service
      .createQuote(
        createRequest({
          skuId: undefined,
          serviceId: 'service-1',
          requestedAmountForeign: '25' as DecimalString,
          serviceFields: {
            siteUrl: 'https://openai.com/pricing',
            accountPassword: 'hunter2-not-in-the-clear',
          },
        }),
        ACTOR,
      )
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    /* The rejection must not echo the credential back to the caller. */
    expect(JSON.stringify(error)).not.toContain('hunter2-not-in-the-clear');
    expect(context.db.rows.size).toBe(0);
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

  it('prices a gift card from its face value, not from what the supplier charges', async () => {
    /*
     * The SKU is a $50 card we buy at $46.512345. At a 920,000 mid rate and this
     * rule's 2.0% spread + buffer the effective rate is 938,400, so:
     *
     *   charge base   = 50        x 938,400 = 46,920,000   <- what is quoted
     *   supplier cost = 46.512345 x 938,400 = 43,647,184   <- what it costs us
     *   fees          = 1% + 2% of base + 50,000 = 1,457,600
     *   margin        = (46,920,000 - 43,647,184) + 5% of base = 5,618,816
     *   final         = roundUp(50,723,600, 10,000)       = 50,730,000
     */
    const response = await context.service.createQuote(createRequest(), ACTOR);
    const row = context.db.only();
    const snapshot = row['snapshot'] as Record<string, unknown>;

    expect(snapshot['customerForeignAmount']).toBe('50');
    expect(snapshot['customerAmountIrr']).toBe('46920000');
    expect(row['finalAmountIrr']).toBe(50_730_000n);

    /* The internal figures are untouched by the change of charge base — the
     * fulfillment tolerance check reads `supplierCostUsd` and compares it to a
     * real invoice, so it has to stay the negotiated price. */
    expect(snapshot['supplierCostUsd']).toBe('46.512345');
    expect(snapshot['supplierCostIrr']).toBe('43647184');
    expect(snapshot['productMarginAmount']).toBe('3272816');
    expect(snapshot['targetMarginAmount']).toBe('2346000');

    /* And the customer is charged more than the 50 dollars are worth, which is
     * the entire point: a card bought cheaply is not a card sold cheaply. */
    expect(BigInt(row['finalAmountIrr'] as bigint)).toBeGreaterThan(46_920_000n);
    expect(response.quote.supplierCostUsd).toBe('50');
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

/* ============================================================================
 * Cards that are not priced in dollars
 *
 * The catalog carries face values in GBP, EUR and JPY while suppliers still
 * invoice in dollars. Two separate defects lived here: the face currency was
 * being used to filter supplier offers, which reported stocked cards as
 * unavailable, and — had an offer been found — a £25 face value would have been
 * priced as though it were $25.
 * ==========================================================================*/

describe('QuotesService.createQuote — non-USD face values', () => {
  let context: Harness;

  beforeEach(() => {
    context = harness({ skuTarget: GBP_SKU_TARGET });
  });

  function gbpRequest(overrides: Partial<CreateQuoteRequest> = {}): CreateQuoteRequest {
    return createRequest({ skuId: 'sku-gbp-1', currency: 'GBP', ...overrides });
  }

  it('looks up supplier offers by the invoice currency, not the face currency', async () => {
    await context.service.createQuote(gbpRequest(), ACTOR);

    /*
     * The bug in one line. Asking the catalog for a GBP-priced offer on a card
     * nobody invoices in pounds returns nothing, and the customer is told a
     * fully stocked card is out of stock.
     */
    expect(context.getSkuQuoteTarget).toHaveBeenCalledWith('sku-gbp-1', 'USD');
  });

  it('converts the face value to dollars before pricing it', async () => {
    /*
     * A £25 card we buy for $33.44, at GBP 0.74756 per dollar and a 920,000 mid
     * rate with this rule's 2.0% spread + buffer (effective 938,400):
     *
     *   charge base   = 25 / 0.74756 = $33.442132 x 938,400 = 31,382,096
     *   supplier cost = $33.44                    x 938,400 = 31,380,096
     *
     * Pricing the face value as though it were $25 — which is what happened
     * before the conversion existed — puts the charge base at 23,460,000, some
     * eight million rial BELOW what the card costs us.
     */
    await context.service.createQuote(gbpRequest(), ACTOR);
    const snapshot = context.db.only()['snapshot'] as Record<string, unknown>;

    expect(snapshot['chargeBaseUsd']).toBe('33.442132');
    expect(snapshot['supplierCostUsd']).toBe('33.440000');
    expect(snapshot['customerAmountIrr']).toBe('31382096');
    expect(Number(snapshot['customerAmountIrr'])).toBeGreaterThan(
      Number(snapshot['supplierCostIrr']),
    );
  });

  it('asks for both legs: the face currency and the invoice currency', async () => {
    await context.service.createQuote(gbpRequest(), ACTOR);

    expect(context.getCrossRate).toHaveBeenCalledWith('GBP');
    expect(context.getCrossRate).toHaveBeenCalledWith('USD');
  });

  it('shows the customer the face currency, not the dollars in between', async () => {
    const response = await context.service.createQuote(gbpRequest({ quantity: 2 }), ACTOR);
    const row = context.db.only();

    /* The proforma reads «۵۰ پوند». A customer holding a card marked £25 has no
     * way to check a dollar figure, and no reason to be shown one. */
    expect(response.breakdown.supplierCostForeign).toBe('50');
    expect(response.breakdown.supplierCostCurrency).toBe('GBP');
    expect(row['currency']).toBe('GBP');
    expect((row['snapshot'] as Record<string, unknown>)['customerForeignCurrency']).toBe('GBP');
  });

  it('takes the currency from the catalog even when the request omits it', async () => {
    await context.service.createQuote(
      createRequest({ skuId: 'sku-gbp-1', currency: undefined }),
      ACTOR,
    );

    /* It used to default to `'USD'`, which relabelled a £25 card as a $25 one
     * on the customer's own invoice. */
    expect(context.db.only()['currency']).toBe('GBP');
  });

  it('records both rates so the price can be re-derived from the snapshot alone', async () => {
    await context.service.createQuote(gbpRequest(), ACTOR);
    const snapshot = context.db.only()['snapshot'] as Record<string, unknown>;
    const rates = snapshot['crossRates'] as Record<string, Record<string, unknown>>;

    expect(rates['face']).toMatchObject({
      currency: 'GBP',
      unitsPerUsd: '0.74756',
      provider: 'frankfurter',
      publishedOn: '2026-08-30',
    });
    expect(rates['cost']).toMatchObject({ currency: 'USD', isIdentity: true });
  });

  it('refuses to price against a stale cross rate', async () => {
    context.getCrossRate.mockImplementation(async (currency: string) =>
      crossRate(currency, currency === 'GBP' ? { isStale: true, ageSeconds: 90_000 } : {}),
    );

    /* Same policy as the rial leg: a price built on a rate we no longer stand
     * behind is worse than no price. */
    await expect(context.service.createQuote(gbpRequest(), ACTOR)).rejects.toMatchObject({
      code: 'FX_RATE_STALE',
    });
    expect(context.db.rows.size).toBe(0);
  });

  it('refuses a currency the feed does not carry', async () => {
    context.getCrossRate.mockImplementation(async (currency: string) => {
      if (currency === 'GBP') {
        throw new CrossRateUnavailableError('GBP', 'UNSUPPORTED_CURRENCY');
      }
      return crossRate(currency);
    });

    await expect(context.service.createQuote(gbpRequest(), ACTOR)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(context.db.rows.size).toBe(0);
  });

  it('produces a contract-valid response for a non-USD card', async () => {
    const response = await context.service.createQuote(gbpRequest(), ACTOR);
    expect(() => createQuoteResponseSchema.parse(response)).not.toThrow();
  });

  it('carries the face currency through acceptance unchanged', async () => {
    const created = await context.service.createQuote(gbpRequest(), ACTOR);

    const accepted = await context.service.acceptQuote(
      {
        quoteId: created.quote.id,
        idempotencyKey: 'idem-accept-gbp-0123456789',
        acknowledgedAmountIrr: created.quote.finalAmountIrr,
      } as never,
      ACTOR,
    );

    expect(() => acceptQuoteResponseSchema.parse(accepted)).not.toThrow();
    expect(accepted.quote.status).toBe('ACCEPTED');
    expect(accepted.quote.currency).toBe('GBP');
    /* Acceptance never re-prices, so the rate it was quoted at is the rate it
     * is bought at — including the cross leg. */
    expect(accepted.quote.finalAmountIrr).toBe(created.quote.finalAmountIrr);
  });

  it('keeps a JPY card honest, where an inverted rate would show', async () => {
    const jpy = harness({
      skuTarget: {
        ...GBP_SKU_TARGET,
        sku: {
          ...GBP_SKU_TARGET.sku,
          id: 'sku-jpy-1',
          currency: 'JPY',
          faceValue: new Decimal('10000'),
          denominationLabel: '¥10,000',
        },
        listedCost: '60',
        effectiveCost: '60',
      },
    });

    await jpy.service.createQuote(
      createRequest({ skuId: 'sku-jpy-1', currency: 'JPY' }),
      ACTOR,
    );
    const snapshot = jpy.db.only()['snapshot'] as Record<string, unknown>;

    /* 10,000 / 157.39 = $63.536438. Inverting the rate to six places first and
     * multiplying instead gives $63.53, which is 6,000 rial of margin lost on
     * one card for no reason other than arithmetic. */
    expect(snapshot['chargeBaseUsd']).toBe('63.536438');
    expect(snapshot['customerForeignAmount']).toBe('10000');
    expect(snapshot['customerForeignCurrency']).toBe('JPY');
  });
});

/* ============================================================================
 * Direct top-up
 *
 * A top-up is priced exactly like anything else — through the one pricing
 * engine and the one rule table (AGENTS.md §5) — but it differs in three ways
 * that each cost real money if they are wrong, and those are what these tests
 * are about:
 *
 *   1. It must select the TOP_UP_GAME rule, so an operator's top-up margin is
 *      what is applied and the gift-card rate is left alone.
 *   2. The quote row must carry `topUpOfferId`, because that column is what
 *      routes the paid order away from the operator queue. A null there is a
 *      paid top-up sitting in a human's inbox.
 *   3. The customer's game account must be frozen into the snapshot, and must
 *      be the venue's own key set — a key the venue did not ask for is a
 *      purchase that cannot be credited.
 * ==========================================================================*/

describe('QuotesService.createQuote — direct top-up', () => {
  function topUpRequest(overrides: Partial<CreateQuoteRequest> = {}): CreateQuoteRequest {
    return {
      topUpOfferId: 'topup-offer-1',
      topUpAccountFields: { telegram_username: 'player_one' },
      quantity: 1,
      ...overrides,
    } as CreateQuoteRequest;
  }

  it('uses and freezes a fresh Stars price rather than the stale catalog cost', async () => {
    const context = harness({
      liveTopUpPrice: {
        providerSku: 'telegram:stars:500',
        cost: { amount: '5.123456', currency: 'USD' },
        observedAt: new Date('2026-08-30T09:59:45.000Z'),
      },
    });
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await context.service.createQuote(topUpRequest(), ACTOR);

    expect(context.getLivePrice).toHaveBeenCalledTimes(1);
    expect(context.getLivePrice).toHaveBeenCalledWith({
      supplierCode: 'fazercards',
      providerSku: 'telegram:stars:500',
    });
    expect(context.computeQuote.mock.calls[0]?.[0]).toMatchObject({
      supplierCostUsd: new Decimal('5.123456'),
      customerForeignAmount: new Decimal('5.123456'),
    });
    const snapshot = context.db.only()['snapshot'] as Record<string, unknown>;
    const topUp = (snapshot['target'] as Record<string, unknown>)['topUp'] as Record<string, unknown>;
    expect(topUp).toMatchObject({
      catalogCostAmount: '4.750000',
      costAmount: '5.123456',
      costCurrency: 'USD',
      priceObservedAt: '2026-08-30T09:59:45.000Z',
    });
    expect((context.db.only()['supplierCostUsd'] as Decimal).toFixed(6)).toBe('5.123456');
  });

  it('uses and freezes a fresh Premium price rather than the stale catalog cost', async () => {
    const premium = topUpTarget({
      offer: { ...(topUpTarget()['offer'] as Record<string, unknown>), id: 'topup-premium-3m', providerOfferId: 'premium-3m', costAmount: new Decimal('8.00') },
      game: { ...(topUpTarget()['game'] as Record<string, unknown>), id: 'topup-premium-game', slug: 'telegram-premium' },
      costAmount: '8.000000',
      providerSku: 'telegram:premium:3m',
    });
    const context = harness({
      topUpTarget: premium,
      liveTopUpPrice: {
        providerSku: 'telegram:premium:3m',
        cost: { amount: '9.654321', currency: 'USD' },
        observedAt: new Date('2026-08-30T09:59:46.000Z'),
      },
    });
    context.rules.value = [{ ...TOP_UP_RULE, targetId: 'topup-premium-game' }, GLOBAL_RULE];

    await context.service.createQuote(topUpRequest({ topUpOfferId: 'topup-premium-3m' }), ACTOR);

    expect(context.getLivePrice).toHaveBeenCalledWith({
      supplierCode: 'fazercards',
      providerSku: 'telegram:premium:3m',
    });
    expect(context.computeQuote.mock.calls[0]?.[0]).toMatchObject({
      supplierCostUsd: new Decimal('9.654321'),
      customerForeignAmount: new Decimal('9.654321'),
    });
    const snapshot = context.db.only()['snapshot'] as Record<string, unknown>;
    const topUp = (snapshot['target'] as Record<string, unknown>)['topUp'] as Record<string, unknown>;
    expect(topUp['costAmount']).toBe('9.654321');
    expect(topUp['catalogCostAmount']).toBe('8.000000');
  });

  it('fails closed when no direct top-up provider is registered', async () => {
    const context = harness({ liveTopUpPrice: null });
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await expect(context.service.createQuote(topUpRequest(), ACTOR)).rejects.toMatchObject({ status: 409 });

    expect(context.getLivePrice).toHaveBeenCalledWith({
      supplierCode: 'fazercards',
      providerSku: 'telegram:stars:500',
    });
    expect(context.db.rows.size).toBe(0);
  });

  it.each(['0', '-1', 'not-a-price', 'Infinity'])('refuses an invalid live top-up price of %s', async (amount) => {
    const context = harness({
      liveTopUpPrice: {
        providerSku: 'telegram:stars:500',
        cost: { amount, currency: 'USD' },
        observedAt: new Date('2026-08-30T09:59:45.000Z'),
      },
    });
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await expect(context.service.createQuote(topUpRequest(), ACTOR)).rejects.toMatchObject({ status: 409 });
    expect(context.db.rows.size).toBe(0);
  });

  it('refuses a live price for a different supplier SKU', async () => {
    const context = harness({
      liveTopUpPrice: {
        providerSku: 'telegram:premium:12',
        cost: { amount: '5.123456', currency: 'USD' },
        observedAt: new Date('2026-08-30T09:59:45.000Z'),
      },
    });
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await expect(context.service.createQuote(topUpRequest(), ACTOR)).rejects.toMatchObject({ status: 409 });
    expect(context.db.rows.size).toBe(0);
  });

  it('prices with the TOP_UP_GAME rule, not the global one', async () => {
    const context = harness();
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await context.service.createQuote(topUpRequest(), ACTOR);

    expect(context.db.only()['pricingRuleId']).toBe('rule-topup-1');
  });

  it('falls back to the untargeted TOP_UP_GAME rule before the global one', async () => {
    const context = harness();
    /* No rule names this game. Before the fallback step existed, this is the
     * quote that silently took the gift-card margin in production. */
    context.rules.value = [GLOBAL_RULE, TOP_UP_FALLBACK_RULE];

    await context.service.createQuote(topUpRequest(), ACTOR);

    expect(context.db.only()['pricingRuleId']).toBe('rule-topup-fallback');
  });

  it('prefers a rule for this game over the untargeted top-up rule', async () => {
    const context = harness();
    context.rules.value = [GLOBAL_RULE, TOP_UP_FALLBACK_RULE, TOP_UP_RULE];

    await context.service.createQuote(topUpRequest(), ACTOR);

    expect(context.db.only()['pricingRuleId']).toBe('rule-topup-1');
  });

  it('ignores a rule that targets a different game', async () => {
    const context = harness();
    context.rules.value = [GLOBAL_RULE, TOP_UP_FALLBACK_RULE, { ...TOP_UP_RULE, targetId: 'another-game' }];

    await context.service.createQuote(topUpRequest(), ACTOR);

    expect(context.db.only()['pricingRuleId']).toBe('rule-topup-fallback');
  });

  it('prices with the global rule when no TOP_UP_GAME rule exists at all', async () => {
    const context = harness();
    context.rules.value = [GLOBAL_RULE];

    await context.service.createQuote(topUpRequest(), ACTOR);

    expect(context.db.only()['pricingRuleId']).toBe('rule-global-1');
  });

  it('never applies the untargeted top-up rule to a gift card', async () => {
    const context = harness();
    context.rules.value = [TOP_UP_FALLBACK_RULE, GLOBAL_RULE];

    await context.service.createQuote(createRequest(), ACTOR);

    expect(context.db.only()['pricingRuleId']).toBe('rule-global-1');
  });

  it('stores the offer id, which is what keeps the order out of the queue', async () => {
    const context = harness();
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await context.service.createQuote(topUpRequest(), ACTOR);

    const row = context.db.only();
    expect(row['topUpOfferId']).toBe('topup-offer-1');
    /* The other two targets must stay null. An order that looks like a SKU and
     * a top-up at once is exactly the ambiguity `findOrderQuoteTarget` exists
     * to refuse, and the check order there must never have to be relied on. */
    expect(row['skuId']).toBeNull();
    expect(row['serviceId']).toBeNull();
  });

  it('freezes the validated game account into the snapshot', async () => {
    const context = harness();
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await context.service.createQuote(topUpRequest(), ACTOR);

    const snapshot = context.db.only()['snapshot'] as Record<string, unknown>;
    expect(snapshot['topUpAccountFields']).toEqual({ telegram_username: 'player_one' });
    const target = snapshot['target'] as Record<string, unknown>;
    expect(target['kind']).toBe('TOP_UP');
    /* The exact string the adapter will send, composed from two catalog fields
     * a later sync could change. Frozen here, not re-read at purchase time. */
    expect((target['topUp'] as Record<string, unknown>)['providerSku']).toBe('telegram:stars:500');
  });

  it('refuses an account field the game never asked for', async () => {
    const context = harness();

    await expect(
      context.service.createQuote(
        topUpRequest({ topUpAccountFields: { telegram_username: 'player_one', password: 'hunter2' } }),
        ACTOR,
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(context.db.rows.size).toBe(0);
  });

  it('refuses a missing required account field, before anything is priced', async () => {
    const context = harness();

    await expect(
      context.service.createQuote(topUpRequest({ topUpAccountFields: {} }), ACTOR),
    ).rejects.toMatchObject({ status: 400 });

    expect(context.db.rows.size).toBe(0);
  });

  it('refuses an account field that does not match the venue format', async () => {
    const context = harness();

    await expect(
      /* The venue's own pattern is `^[A-Za-z][A-Za-z0-9_]{3,31}$`. Validating
       * it here is the difference between a free rejection and a purchase the
       * venue refuses after the customer has been charged. */
      context.service.createQuote(
        topUpRequest({ topUpAccountFields: { telegram_username: '9' } }),
        ACTOR,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('never echoes the submitted value back in a validation error', async () => {
    const context = harness();
    const SECRET_LOOKING = 'not a username!!';

    const error = await context.service
      .createQuote(
        topUpRequest({ topUpAccountFields: { telegram_username: SECRET_LOOKING } }),
        ACTOR,
      )
      .catch((thrown: unknown) => thrown);

    /* A validation response is the most likely place for a value to leak into
     * a log or a client error toast. It must name the field, never the value. */
    expect(JSON.stringify(error)).not.toContain(SECRET_LOOKING);
  });

  it('refuses a request that names two targets at once', async () => {
    const context = harness();

    await expect(
      context.service.createQuote({ skuId: 'sku-1', topUpOfferId: 'topup-offer-1' } as CreateQuoteRequest, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses a currency that is not the offer currency', async () => {
    const context = harness();

    await expect(
      context.service.createQuote(topUpRequest({ currency: 'EUR' }), ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('still refuses a top-up when no TOP_UP_GAME rule and no global rule exist', async () => {
    const context = harness();
    context.rules.value = [];

    await expect(context.service.createQuote(topUpRequest(), ACTOR)).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe('QuotesService.createQuote — variable-amount Steam top-up', () => {
  function steamTarget(): Record<string, unknown> {
    const base = topUpTarget();
    return {
      ...base,
      offer: { ...(base['offer'] as Record<string, unknown>), id: 'steam-custom', providerOfferId: 'custom', name: 'Steam Wallet (custom USD amount)' },
      game: { ...(base['game'] as Record<string, unknown>), id: 'steam-game', slug: 'steam-wallet', providerCategoryId: 'usd' },
      supplierCode: 'fazercards-steam',
      providerSku: 'steam:usd:custom',
      fields: [
        { ...((base['fields'] as Record<string, unknown>[])[0] as Record<string, unknown>), key: 'steam_login', validationRegex: null },
      ],
    };
  }
  function steamRequest(overrides: Partial<CreateQuoteRequest> = {}): CreateQuoteRequest {
    return {
      topUpOfferId: 'steam-custom',
      topUpAccountFields: { steam_login: 'gabe' },
      quantity: 1,
      currency: 'USD',
      requestedAmountForeign: '12.50',
      ...overrides,
    } as CreateQuoteRequest;
  }
  function steamContext(amountSku = 'steam:usd:12.5', cost = '12.5000') {
    const context = harness({
      topUpTarget: steamTarget(),
      liveTopUpPrice: {
        providerSku: amountSku,
        cost: { amount: cost, currency: 'USD' },
        observedAt: new Date('2026-08-30T09:59:45.000Z'),
      },
    });
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];
    return context;
  }

  it('prices and freezes the SKU for the amount the customer typed', async () => {
    const context = steamContext();

    await context.service.createQuote(steamRequest(), ACTOR);

    expect(context.getLivePrice).toHaveBeenCalledWith({
      supplierCode: 'fazercards-steam',
      providerSku: 'steam:usd:12.5',
    });
    expect(context.computeQuote.mock.calls[0]?.[0]).toMatchObject({
      supplierCostUsd: new Decimal('12.5'),
      customerForeignAmount: new Decimal('12.5'),
    });
    const snapshot = context.db.only()['snapshot'] as Record<string, unknown>;
    const topUp = (snapshot['target'] as Record<string, unknown>)['topUp'] as Record<string, unknown>;
    expect(topUp['providerSku']).toBe('steam:usd:12.5');
    expect(topUp['name']).toBe('Steam Wallet $12.5');
    expect(snapshot['topUpAccountFields']).toEqual({ steam_login: 'gabe' });
  });

  it('never sends the template SKU to the venue', async () => {
    const context = steamContext();
    await context.service.createQuote(steamRequest(), ACTOR);
    const calls = context.getLivePrice.mock.calls as unknown as [{ providerSku: string }][];
    expect(calls.every(([arg]) => arg.providerSku !== 'steam:usd:custom')).toBe(true);
  });

  it.each([
    ['missing', undefined],
    ['malformed', '5.999'],
    ['below the minimum', '0.10'],
    ['above the maximum', '1000.01'],
  ])('refuses a %s amount before asking the venue for a price', async (_label, amount) => {
    const context = steamContext();
    const request = steamRequest();
    if (amount === undefined) delete (request as { requestedAmountForeign?: string }).requestedAmountForeign;
    else (request as { requestedAmountForeign?: string }).requestedAmountForeign = amount;

    await expect(context.service.createQuote(request, ACTOR)).rejects.toMatchObject({ status: 400 });

    expect(context.getLivePrice).not.toHaveBeenCalled();
    expect(context.db.rows.size).toBe(0);
  });

  it('ignores a typed amount on a fixed offer', async () => {
    const context = harness();
    context.rules.value = [GLOBAL_RULE, TOP_UP_RULE];

    await context.service.createQuote(
      {
        topUpOfferId: 'topup-offer-1',
        topUpAccountFields: { telegram_username: 'player_one' },
        quantity: 1,
        currency: 'USD',
        requestedAmountForeign: '999',
      } as unknown as CreateQuoteRequest,
      ACTOR,
    );

    expect(context.getLivePrice).toHaveBeenCalledWith({
      supplierCode: 'fazercards',
      providerSku: 'telegram:stars:500',
    });
  });

  it('refuses a venue price quoted for a different amount than was typed', async () => {
    const context = steamContext('steam:usd:99', '99.0000');

    await expect(context.service.createQuote(steamRequest(), ACTOR)).rejects.toMatchObject({ status: 409 });
    expect(context.db.rows.size).toBe(0);
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

/* ============================================================================
 * fromPrices — the advertised «از ...» floor on a product card
 * ==========================================================================*/

describe('QuotesService.fromPrices', () => {
  /** A dollar-faced, dollar-billed denomination; the catalog's majority case. */
  function candidate(overrides: Partial<Record<string, string>> = {}) {
    return {
      productId: 'product-1',
      skuId: 'sku-1',
      faceValue: '10',
      currency: 'USD',
      effectiveCost: '10',
      ...overrides,
    };
  }

  /** What the real engine says the card should advertise. */
  function expectedFinal(effectiveCost: string, faceValue: string): string {
    const engine = new PricingService();
    return engine
      .computeQuote(
        {
          supplierCostUsd: new Decimal(effectiveCost),
          customerForeignAmount: new Decimal(faceValue),
          quantity: 1,
        },
        toEnginePricingRule(GLOBAL_RULE as unknown as Parameters<typeof toEnginePricingRule>[0]),
        fxSnapshot(),
      )
      .finalAmountIrr.toString();
  }

  it('advertises each product at its cheapest denomination, priced by the real engine', async () => {
    const context = harness({
      fromPriceCandidates: [
        candidate({ skuId: 'sku-50', effectiveCost: '46.512345', faceValue: '50' }),
        candidate({ skuId: 'sku-10' }),
        candidate({ productId: 'product-2', skuId: 'sku-other', effectiveCost: '20', faceValue: '20' }),
      ],
    });

    const prices = await context.service.fromPrices(['product-1', 'product-2']);

    /* The $10 card is the floor for product-1, and the amount is exactly what
     * createQuote would produce for it — same engine, same rule, same FX. */
    expect(prices).toEqual({
      'product-1': expectedFinal('10', '10'),
      'product-2': expectedFinal('20', '20'),
    });
    /* The quote path's cost-currency filter is reused verbatim. */
    expect(context.getFromPriceCandidates).toHaveBeenCalledWith(['product-1', 'product-2'], 'USD');
  });

  it('returns nothing at all on a stale dollar rate, and does not cache the outage', async () => {
    const context = harness({ fromPriceCandidates: [candidate()] });
    context.getRateSnapshot.mockResolvedValueOnce({ ...fxSnapshot(), isStale: true });

    expect(await context.service.fromPrices(['product-1'])).toEqual({});

    /* The next call sees the recovered rate instead of a 60-second blackout. */
    expect(await context.service.fromPrices(['product-1'])).toEqual({
      'product-1': expectedFinal('10', '10'),
    });
  });

  it('omits a product whose scope ladder matches no rule', async () => {
    const context = harness({ fromPriceCandidates: [candidate()] });
    context.rules.value = [{ ...GLOBAL_RULE, scope: 'SKU', targetId: 'some-other-sku' }];

    expect(await context.service.fromPrices(['product-1'])).toEqual({});
  });

  it('drops a face currency with no usable cross rate and keeps the rest', async () => {
    const context = harness({
      fromPriceCandidates: [
        candidate(),
        candidate({ productId: 'product-gbp', skuId: 'sku-gbp', currency: 'GBP', faceValue: '25', effectiveCost: '33.44' }),
      ],
    });
    context.getCrossRate.mockImplementation(async (currency: string) => {
      if (currency === 'GBP') throw new CrossRateUnavailableError('GBP', 'UNSUPPORTED_CURRENCY');
      return crossRate(currency);
    });

    expect(await context.service.fromPrices(['product-1', 'product-gbp'])).toEqual({
      'product-1': expectedFinal('10', '10'),
    });
  });

  it('serves repeat lookups from the cache instead of re-running the engine', async () => {
    const context = harness({ fromPriceCandidates: [candidate()] });

    const first = await context.service.fromPrices(['product-1']);
    const second = await context.service.fromPrices(['product-1']);

    expect(second).toEqual(first);
    expect(context.getFromPriceCandidates).toHaveBeenCalledTimes(1);
  });

  it('never surfaces supplier identity or cost in the response', async () => {
    const context = harness({ fromPriceCandidates: [candidate({ effectiveCost: '46.512345', faceValue: '50' })] });

    const prices = await context.service.fromPrices(['product-1']);

    const serialized = JSON.stringify(prices);
    expect(serialized).not.toContain(SUPPLIER_ID);
    expect(serialized).not.toContain('46.512345');
    /* Only the final rial figure crosses the boundary. */
    expect(Object.values(prices)).toEqual([expectedFinal('46.512345', '50')]);
  });
});
