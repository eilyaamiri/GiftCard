import { afterEach, describe, expect, it, vi } from 'vitest';
import Decimal from 'decimal.js';
import { MockRialPaymentProvider } from '@barat/payments';
import { FazerCardsTelegramSupplierProvider } from '@barat/suppliers';
import type { CreateQuoteRequest, IrrString } from '@barat/contracts';

// The pricing-rule module imports the database singleton at load time. Nothing in
// this test may construct a Prisma client or connect to a gateway or supplier.
vi.mock('@barat/database', () => ({
  prisma: {},
  Prisma: { JsonNull: null, TransactionIsolationLevel: { Serializable: 'Serializable' } },
  PricingRuleScope: { GLOBAL: 'GLOBAL', TOP_UP_GAME: 'TOP_UP_GAME' },
}));

import { AuditService, type AuditWriter } from '../audit/audit.service';
import type { CatalogService } from '../catalog/catalog.service';
import { OrderStateMachine } from '../orders/order-state-machine';
import { OrdersService } from '../orders/orders.service';
import type { OrdersDatabase } from '../orders/orders.tokens';
import { PricingService } from '../pricing/pricing.service';
import type { PricingRuleService } from '../pricing/pricing-rule.service';
import { QuotesService } from '../quotes/quotes.service';
import type { QuotesDatabase } from '../quotes/quote.ports';
import { AutoFulfillmentService } from '../suppliers/auto-fulfillment.service';
import { TopUpFulfillmentService } from '../suppliers/topup-fulfillment.service';
import { InMemoryTopUpStore } from '../suppliers/testing/in-memory-topup.store';
import type { TopUpTarget } from '../suppliers/suppliers.types';
import { WorkItemsService } from '../workitems/workitems.service';
import { InMemoryWorkItemStore } from '../workitems/testing/in-memory-workitem.store';
import { PaymentsService, type PaymentDatabase } from './payments.service';

type Row = Record<string, any>;
const CUSTOMER = 'customer-telegram';
const USERNAME = 'player_one';
const CALLBACK_URL = 'https://example.invalid/payment/callback';
const CREATED_AT = new Date('2026-09-01T12:00:00Z');

// One shared store for quote, order and payment. Reads are detached (as with
// Prisma); conditional writes really check their guards, so a replay cannot pass
// merely because the fake indiscriminately updates rows.
class MemoryDatabase {
  readonly rows: Record<string, Row[]> = {
    quote: [], quoteComponent: [], order: [], payment: [], paymentAttempt: [],
    reconciliationIssue: [], auditLog: [],
  };
  private sequence = 0;

  private matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, value]) => {
      if (key === 'provider_providerAuthority') {
        return this.matches(row, value as Row);
      }
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if (Array.isArray(value.in)) return value.in.includes(row[key]);
        if (value.gt instanceof Date) return row[key] instanceof Date && row[key] > value.gt;
        if (value.gte instanceof Date) return row[key] instanceof Date && row[key] >= value.gte;
        if ('not' in value) return row[key] !== value.not;
      }
      return row[key] === value;
    });
  }

  private project(table: string, row: Row, args: Row): Row {
    const copy = { ...row };
    if (table === 'quote' && args.include) {
      copy.components = this.rows.quoteComponent!.filter((part) => part.quoteId === row.id);
    }
    if (table === 'order' && args.include) {
      copy.quote = { ...this.rows.quote!.find((quote) => quote.id === row.quoteId),
        sku: null, service: null };
      copy.giftCardAssets = [];
      copy.topUpFulfillments = [];
    }
    return copy;
  }

  private delegate(table: string) {
    const rows = this.rows[table]!;
    return {
      findUnique: async (args: Row) => {
        const row = rows.find((candidate) => this.matches(candidate, args.where));
        return row ? this.project(table, row, args) : null;
      },
      findUniqueOrThrow: async (args: Row) => {
        const row = rows.find((candidate) => this.matches(candidate, args.where));
        if (!row) throw new Error(`Missing ${table}`);
        return this.project(table, row, args);
      },
      findFirst: async (args: Row) => {
        const row = rows.find((candidate) => this.matches(candidate, args.where));
        return row ? this.project(table, row, args) : null;
      },
      findMany: async (args: Row) => rows.filter((candidate) => this.matches(candidate, args.where)),
      count: async (args: Row) => rows.filter((candidate) => this.matches(candidate, args.where)).length,
      create: async (args: Row) => {
        const data = args.data as Row;
        const row = {
          id: data.id ?? `${table}-${++this.sequence}`,
          createdAt: new Date(), updatedAt: new Date(),
          ...(table === 'quote' ? { acceptedAt: null, idempotencyKey: null, cancelledAt: null } : {}),
          ...(table === 'order' ? { paidAt: null, fulfilledAt: null, cancelledAt: null, failureReason: null } : {}),
          ...(table === 'payment' ? {
            providerAuthority: null, providerRefId: null, providerAmount: null,
            providerAmountUnit: null, maskedCard: null, cardHash: null,
            failureReason: null, verifiedAt: null,
          } : {}),
          ...data,
          ...(table === 'quote' ? {
            marketFxRate: new Decimal(data.marketFxRate),
            effectiveFxRate: new Decimal(data.effectiveFxRate),
            supplierCostUsd: new Decimal(data.supplierCostUsd),
          } : {}),
        };
        rows.push(row);
        return this.project(table, row, args);
      },
      createMany: async (args: Row) => {
        for (const data of args.data as Row[]) rows.push({ ...data });
        return { count: (args.data as Row[]).length };
      },
      update: async (args: Row) => {
        const row = rows.find((candidate) => this.matches(candidate, args.where));
        if (!row) throw new Error(`Missing ${table} update`);
        Object.assign(row, args.data);
        return { ...row };
      },
      updateMany: async (args: Row) => {
        const matches = rows.filter((candidate) => this.matches(candidate, args.where));
        for (const row of matches) Object.assign(row, args.data);
        return { count: matches.length };
      },
    };
  }

  readonly quote = this.delegate('quote');
  readonly quoteComponent = this.delegate('quoteComponent');
  readonly order = this.delegate('order');
  readonly payment = this.delegate('payment');
  readonly paymentAttempt = this.delegate('paymentAttempt');
  readonly reconciliationIssue = this.delegate('reconciliationIssue');
  readonly auditLog = this.delegate('auditLog');
  readonly commerceSession = { upsert: async () => ({ id: 'session-1' }) };
  async $transaction<T>(operation: (tx: this) => Promise<T>): Promise<T> {
    const backup = Object.fromEntries(Object.entries(this.rows).map(([name, rows]) =>
      [name, rows.map((row) => ({ ...row }))],
    )) as Record<string, Row[]>;
    try { return await operation(this); }
    catch (error) {
      for (const [name, rows] of Object.entries(backup)) this.rows[name] = rows;
      throw error;
    }
  }
}

function gameOffer(kind: 'stars' | 'premium') {
  const stars = kind === 'stars';
  const sku = stars ? 'telegram:stars:500' : 'telegram:premium:3';
  const cost = stars ? '4.750000' : '12.000000';
  return {
    offer: {
      id: `offer-${kind}`, gameId: 'telegram-game', providerOfferId: sku,
      name: stars ? '500 Stars' : '3 Months Premium', nameFa: 'تلگرام',
      costAmount: new Decimal(cost), costCurrency: 'USD',
      isActive: true, isListed: true, sortOrder: 0, lastSyncedAt: null,
      createdAt: CREATED_AT, updatedAt: CREATED_AT,
    },
    game: {
      id: 'telegram-game', slug: 'telegram', supplierId: 'supplier-telegram',
      providerCategoryId: 'telegram', name: 'Telegram', nameFa: 'تلگرام',
      brandName: 'Telegram', region: 'GLOBAL', imageUrl: null, providerNote: null,
      descriptionFa: null, isActive: true, isListed: true, requiresCredentials: false,
      sortOrder: 0, lastSyncedAt: null, createdAt: CREATED_AT, updatedAt: CREATED_AT,
    },
    supplierId: 'supplier-telegram', supplierCode: 'fazercards-telegram',
    costCurrency: 'USD', costAmount: cost, providerSku: sku,
    fields: [{
      id: 'field-username', gameId: 'telegram-game', key: 'telegram_username',
      label: 'Username', labelFa: 'نام کاربری', fieldType: 'TEXT', isRequired: true,
      options: null, validationRegex: '^[A-Za-z][A-Za-z0-9_]{3,31}$',
      helpTextFa: null, sortOrder: 0, createdAt: CREATED_AT, updatedAt: CREATED_AT,
    }],
  };
}

const PRICING_RULE = {
  id: 'rule-telegram', name: 'Telegram', scope: 'TOP_UP_GAME', targetId: 'telegram-game',
  version: 1, fxSpreadBps: 150, fxRiskBufferBps: 50, serviceFeeBps: 200,
  serviceFeeFixedIrr: 0n, operationalFeeIrr: 50_000n, targetMarginBps: 500,
  minimumMarginIrr: 100_000n, paymentFeeBps: 100, paymentFeeFixedIrr: 0n,
  quoteTtlSeconds: 600, roundingStepIrr: 10_000n,
  maxSupplierCostToleranceBps: 500, isActive: true, effectiveFrom: CREATED_AT,
  effectiveTo: null, createdByStaffId: null, createdAt: CREATED_AT, updatedAt: CREATED_AT,
};

const fetchMock = vi.fn<typeof fetch>();
afterEach(() => { vi.unstubAllGlobals(); fetchMock.mockReset(); });

describe.each(['stars', 'premium'] as const)('Telegram %s paid top-up journey', (kind) => {
  it('prices, orders, verifies server-side, posts the correct body and persists a task-free trace', async () => {
    const db = new MemoryDatabase();
    const auditRows: Row[] = [];
    const audit = new AuditService({ append: async (entry) => {
      auditRows.push(entry as Row);
    } } as AuditWriter);
    const offer = gameOffer(kind);
    const pricing = new PricingService();
    const quoteService = new QuotesService(
      db as unknown as QuotesDatabase,
      { getTopUpOfferForQuote: async () => offer } as unknown as CatalogService,
      { list: async () => [PRICING_RULE] } as unknown as PricingRuleService,
      pricing,
      { getRateSnapshot: async () => ({
        id: 'fx-1', pair: 'USD_IRR', buyRate: '920000', sellRate: '920000',
        midRate: '920000', provider: 'mock-fx', source: 'API',
        receivedAt: new Date().toISOString(), effectiveAt: new Date().toISOString(),
        expiresAt: null, isManualOverride: false, overrideReason: null,
        ageSeconds: 0, isStale: false,
      }) } as never,
      { getSnapshot: async () => ({ currency: 'USD', unitsPerUsd: '1',
        provider: 'identity', source: 'IDENTITY', publishedOn: null,
        receivedAt: new Date().toISOString(), ageSeconds: 0, isStale: false,
        isIdentity: true }) } as never,
      { getLivePrice: async () => ({ providerSku: offer.providerSku,
        cost: { amount: offer.costAmount, currency: 'USD' }, observedAt: new Date() }) } as never,
      audit, {} as never,
    );
    const quoteRequest = {
      topUpOfferId: offer.offer.id, quantity: 1, currency: 'USD',
      topUpAccountFields: { telegram_username: USERNAME },
    } as CreateQuoteRequest;
    const quote = await quoteService.createQuote(quoteRequest, { customerId: CUSTOMER });
    const quoteRow = db.rows.quote![0]!;
    const quotedAmount = quoteRow.finalAmountIrr as bigint;
    expect(quoteRow.topUpOfferId).toBe(offer.offer.id);
    expect(quoteRow.snapshot.topUpAccountFields).toEqual({ telegram_username: USERNAME });
    expect(quote.quote.finalAmountIrr).toBe(quotedAmount.toString());
    const accepted = await quoteService.acceptQuote({ quoteId: quoteRow.id,
      idempotencyKey: `accept-${kind}-123456789`,
      acknowledgedAmountIrr: quotedAmount.toString() as IrrString,
    }, { customerId: CUSTOMER });
    expect(accepted.accepted).toBe(true);

    const orders = new OrdersService(db as unknown as OrdersDatabase,
      new OrderStateMachine(db as unknown as OrdersDatabase), audit, {} as never);
    const created = await orders.createOrder({ quoteId: quoteRow.id,
      idempotencyKey: `order-${kind}-123456789`,
      acknowledgedAmountIrr: quotedAmount.toString() as IrrString,
    }, { customerId: CUSTOMER });
    const order = db.rows.order![0]!;
    expect(created.created).toBe(true);
    expect(order.status).toBe('AWAITING_PAYMENT');
    expect(order.totalAmountIrr).toBe(quotedAmount);

    // No supplier traffic is allowed except these intercepted requests. If an
    // endpoint changes unexpectedly the fake throws; it never forwards to fetch.
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://supplier.invalid/balance' && init?.method === 'GET') {
        return new Response(JSON.stringify({ ok: true, balance: '1000.0000', currency: 'USD' }), { status: 200 });
      }
      if (url === `https://supplier.invalid/telegram/${kind}/buy` && init?.method === 'POST') {
        return new Response(JSON.stringify({ ok: true, order: { id: 'ord-123', status: 'COMPLETED' } }), { status: 201 });
      }
      throw new Error('Unexpected supplier request');
    });
    vi.stubGlobal('fetch', fetchMock);
    const supplier = new FazerCardsTelegramSupplierProvider({
      apiKey: 'non-secret-test-placeholder', baseUrl: 'https://supplier.invalid',
    });
    const workStore = new InMemoryWorkItemStore();
    // The test store defaults every order to SKU; bind the routing lookup to the
    // persisted quote so the same missed TOP_UP branch cannot silently pass.
    workStore.findOrderQuoteTarget = async (orderId) => {
      const storedOrder = db.rows.order!.find((row) => row.id === orderId);
      const storedQuote = db.rows.quote!.find((row) => row.id === storedOrder?.quoteId);
      return storedQuote?.topUpOfferId ? 'TOP_UP' : 'SKU';
    };
    const workItems = new WorkItemsService(workStore, audit);
    const target: TopUpTarget = {
      orderId: order.id, customerId: CUSTOMER, orderStatus: 'PAID',
      fulfillmentId: `fulfillment-${kind}`, status: 'QUEUED',
      providerSku: offer.providerSku, costAmount: offer.costAmount,
      costCurrency: 'USD', supplierCode: supplier.key, supplierId: offer.supplierId,
      accountFields: quoteRow.snapshot.topUpAccountFields as Record<string, string>,
      providerOrderNumber: null, purchaseAttempts: 0,
    };
    const topUpStore = new InMemoryTopUpStore({ targets: [target],
      orderStatuses: { [order.id]: 'PAID' } });
    const originalTransitionOrder = topUpStore.transitionOrder.bind(topUpStore);
    topUpStore.transitionOrder = async (input) => {
      const moved = await originalTransitionOrder(input);
      if (moved) order.status = input.to;
      return moved;
    };
    const topUps = new TopUpFulfillmentService(topUpStore, [supplier], workItems, audit);
    const topUpAttempt = vi.spyOn(topUps, 'onTopUpOrderPaid');
    const fulfillment = new AutoFulfillmentService(workItems, {} as never,
      {} as never, audit, topUps);
    const gateway = new MockRialPaymentProvider();
    const verify = vi.spyOn(gateway, 'verifyPayment');
    const paymentService = new PaymentsService(gateway, db as unknown as PaymentDatabase,
      audit, fulfillment);
    const started = await paymentService.createPayment({ orderId: order.id,
      idempotencyKey: `pay-${kind}-123456789` }, CUSTOMER, CALLBACK_URL);
    const payment = db.rows.payment![0]!;
    expect(started.payment.status).toBe('REDIRECTED');
    expect(payment.amountIrr).toBe(quotedAmount);
    const callback = await paymentService.callback({ Authority: payment.providerAuthority, Status: 'OK' });
    expect(callback).toMatchObject({ outcome: 'PAID', verified: true });
    expect(verify).toHaveBeenCalledWith({ authority: payment.providerAuthority,
      amountIrr: quotedAmount });
    await vi.waitFor(() => expect(topUpAttempt).toHaveResolvedWith(
      expect.objectContaining({ decision: 'SUCCEEDED', workItemId: null }),
    ));
    expect(db.rows.payment).toHaveLength(1);
    expect(payment.status).toBe('PAID');
    expect(order.status).toBe('FULFILLED');
    expect(topUpStore.statusOf(target.fulfillmentId)).toBe('SUCCEEDED');
    expect(topUpStore.events.map((entry) => entry.event.type)).toEqual(
      expect.arrayContaining(['BALANCE_CHECKED', 'PURCHASE_REQUESTED', 'SUCCEEDED']),
    );
    expect(topUpStore.orderTransitions.at(-1)).toMatchObject({ to: 'FULFILLED' });
    expect(workStore.rows.size).toBe(0);
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]?.[0]).toBe(`https://supplier.invalid/telegram/${kind}/buy`);
    expect(JSON.parse(posts[0]![1]!.body as string)).toEqual(kind === 'stars'
      ? { telegram_username: USERNAME, quantity: 500 }
      : { telegram_username: USERNAME, months: 3 });
    expect(auditRows.some((entry) => entry.action === 'TOP_UP_FULFILLMENT_ATTEMPTED')).toBe(true);

    const replay = await paymentService.callback({ Authority: payment.providerAuthority, Status: 'OK' });
    expect(replay).toMatchObject({ outcome: 'PAID', verified: false });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(topUpAttempt).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1);
    expect(workStore.rows.size).toBe(0);
  });
});
