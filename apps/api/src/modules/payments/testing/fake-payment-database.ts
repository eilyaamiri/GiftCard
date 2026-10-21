import { ALLOWED_TRANSITIONS, IllegalOrderTransition, LATE_PAYMENT_TRANSITIONS } from '../../orders/order-state-machine';
import type { OrderPaymentBridge, OrderTransitionResult } from '../../orders/orders.tokens';
import type { OrderStatus } from '@barat/contracts';
import type { PaymentDatabase } from '../payments.service';

/* ============================================================================
 * In-memory stand-in for the Prisma delegates the payments module uses.
 *
 * Unit tests must never touch PostgreSQL or a payment gateway, but they must
 * still exercise the real idempotency logic — which is expressed as conditional
 * `updateMany` statements and unique indexes. So this fake implements the slice
 * of the query surface the module actually calls: `{ in }`, `{ not }`, `{ lt }`,
 * `{ gt }`, `OR`, the `provider_providerAuthority` compound key, the order's
 * `none` relation filters, the unique columns the money invariants rest on,
 * detached read results and transaction rollback.
 * ==========================================================================*/

export type Row = Record<string, unknown>;

export type TableName =
  | 'quote'
  | 'order'
  | 'payment'
  | 'paymentAttempt'
  | 'reconciliationIssue'
  | 'refund'
  | 'workItem'
  | 'topUpFulfillment';

export interface RecordedCall {
  readonly table: TableName;
  readonly operation: string;
  readonly args: Record<string, unknown>;
}

const TABLE_NAMES: readonly TableName[] = [
  'quote',
  'order',
  'payment',
  'paymentAttempt',
  'reconciliationIssue',
  'refund',
  'workItem',
  'topUpFulfillment',
];

/** Unique columns, as the schema declares them. NULLs never collide. */
const UNIQUE_COLUMNS: Readonly<Partial<Record<TableName, readonly string[]>>> = {
  payment: ['idempotencyKey', 'liveOrderKey', 'paidOrderKey'],
  reconciliationIssue: ['openDedupeKey'],
};

/** Columns that must read as `null` rather than `undefined` when never written. */
const NULLABLE_DEFAULTS: Readonly<Record<TableName, readonly string[]>> = {
  quote: ['acceptedAt'],
  order: ['paidAt'],
  payment: [
    'providerAuthority',
    'providerRefId',
    'providerRequestCode',
    'providerVerifyCode',
    'providerAmount',
    'providerAmountUnit',
    'providerFee',
    'providerFeeType',
    'maskedCard',
    'cardHash',
    'failureReason',
    'liveOrderKey',
    'paidOrderKey',
    'verifyLeaseUntil',
    'verifyLeaseToken',
    'requestedAt',
    'redirectedAt',
    'callbackAt',
    'verifiedAt',
  ],
  paymentAttempt: ['providerCode', 'providerMessage', 'ip', 'userAgent', 'durationMs'],
  reconciliationIssue: ['paymentId', 'orderId', 'expectedAmountIrr', 'actualAmountIrr', 'differenceIrr', 'openDedupeKey'],
  refund: ['paymentId', 'requestedByStaffId', 'approvedByStaffId', 'providerRefundRef', 'processedAt'],
  workItem: [],
  topUpFulfillment: [],
};

function valuesEqual(left: unknown, right: unknown): boolean {
  const l = left === undefined ? null : left;
  const r = right === undefined ? null : right;
  if (typeof l === 'bigint' || typeof r === 'bigint') {
    if (l === null || r === null) return false;
    return String(l) === String(r);
  }
  if (l instanceof Date && r instanceof Date) return l.getTime() === r.getTime();
  return l === r;
}

function sortKey(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return typeof value === 'number' ? value : 0;
}

export class FakeTable {
  constructor(
    private readonly store: FakePaymentDatabase,
    private readonly name: TableName,
  ) {}

  private get rows(): Row[] {
    return this.store.tables[this.name];
  }

  private where(args: Record<string, unknown>): Record<string, unknown> {
    return (args['where'] as Record<string, unknown> | undefined) ?? {};
  }

  /**
   * Always returns a detached copy, like Prisma does. Handing out the live row
   * would hide read-your-own-stale-snapshot races, which is exactly what the
   * idempotency tests need to reproduce.
   */
  private hydrate(row: Row, args: Record<string, unknown>): Row {
    const include = args['include'] as Record<string, unknown> | undefined;
    if (include?.['quote'] === true) {
      const quote = this.store.tables.quote.find((candidate) => valuesEqual(candidate['id'], row['quoteId']));
      return { ...row, quote: quote === undefined ? null : { ...quote } };
    }
    return { ...row };
  }

  private matching(args: Record<string, unknown>): Row[] {
    const rows = this.rows.filter((candidate) => this.store.matchesWhere(this.name, candidate, this.where(args)));
    const orderBy = args['orderBy'] as Record<string, 'asc' | 'desc'> | undefined;
    if (orderBy !== undefined) {
      const [[column, direction]] = Object.entries(orderBy) as [[string, 'asc' | 'desc']];
      const sign = direction === 'desc' ? -1 : 1;
      /* Rows written in the same millisecond fall back to insertion order, so
       * "desc" still returns the latest written first. */
      const position = new Map(this.rows.map((row, index) => [row, index]));
      rows.sort(
        (a, b) =>
          sign * (sortKey(a[column]) - sortKey(b[column]) || (position.get(a) ?? 0) - (position.get(b) ?? 0)),
      );
    }
    return rows;
  }

  async findUnique(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'findUnique', args);
    const row = this.matching(args)[0];
    return row === undefined ? null : this.hydrate(row, args);
  }

  async findFirst(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'findFirst', args);
    const row = this.matching(args)[0];
    return row === undefined ? null : this.hydrate(row, args);
  }

  async findMany(args: Record<string, unknown>): Promise<unknown[]> {
    this.store.record(this.name, 'findMany', args);
    const take = args['take'] as number | undefined;
    const rows = this.matching(args);
    return (take === undefined ? rows : rows.slice(0, take)).map((row) => this.hydrate(row, args));
  }

  async create(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'create', args);
    const data = (args['data'] as Row | undefined) ?? {};
    const row: Row = {
      id: (data['id'] as string | undefined) ?? this.store.nextId(this.name),
      createdAt: new Date(),
      updatedAt: new Date(),
      ...Object.fromEntries(NULLABLE_DEFAULTS[this.name].map((column) => [column, null])),
      ...data,
    };
    this.store.assertUnique(this.name, row, null);
    this.rows.push(row);
    return { ...row };
  }

  async update(args: Record<string, unknown>): Promise<unknown> {
    this.store.record(this.name, 'update', args);
    const row = this.matching(args)[0];
    if (row === undefined) throw new Error(`No ${this.name} row matched update`);
    this.store.assertUnique(this.name, { ...row, ...(args['data'] as Row) }, row);
    Object.assign(row, args['data'] as Row);
    return { ...row };
  }

  async updateMany(args: Record<string, unknown>): Promise<{ count: number }> {
    this.store.record(this.name, 'updateMany', args);
    const matched = this.matching(args);
    for (const row of matched) {
      this.store.assertUnique(this.name, { ...row, ...(args['data'] as Row) }, row);
      Object.assign(row, args['data'] as Row);
    }
    return { count: matched.length };
  }

  async count(args: Record<string, unknown>): Promise<number> {
    this.store.record(this.name, 'count', args);
    return this.matching(args).length;
  }
}

export class FakePaymentDatabase implements PaymentDatabase {
  readonly tables: Record<TableName, Row[]> = {
    quote: [],
    order: [],
    payment: [],
    paymentAttempt: [],
    reconciliationIssue: [],
    refund: [],
    workItem: [],
    topUpFulfillment: [],
  };

  readonly calls: RecordedCall[] = [];

  readonly quote: FakeTable;
  readonly order: FakeTable;
  readonly payment: FakeTable;
  readonly paymentAttempt: FakeTable;
  readonly reconciliationIssue: FakeTable;
  readonly refund: FakeTable;

  private sequence = 0;

  constructor(seed: Partial<Record<TableName, readonly Row[]>> = {}) {
    for (const name of TABLE_NAMES) {
      this.tables[name] = [...(seed[name] ?? [])].map((row) => ({ ...row }));
    }
    this.quote = new FakeTable(this, 'quote');
    this.order = new FakeTable(this, 'order');
    this.payment = new FakeTable(this, 'payment');
    this.paymentAttempt = new FakeTable(this, 'paymentAttempt');
    this.reconciliationIssue = new FakeTable(this, 'reconciliationIssue');
    this.refund = new FakeTable(this, 'refund');
  }

  nextId(name: TableName): string {
    this.sequence += 1;
    return `${name}-${this.sequence}`;
  }

  record(table: TableName, operation: string, args: Record<string, unknown>): void {
    this.calls.push({ table, operation, args });
  }

  callsFor(table: TableName, operation: string): readonly RecordedCall[] {
    return this.calls.filter((call) => call.table === table && call.operation === operation);
  }

  matchesWhere(table: TableName, row: Row, where: Record<string, unknown>): boolean {
    for (const [key, condition] of Object.entries(where)) {
      // Prisma compound unique keys arrive as a single nested object.
      if (key === 'provider_providerAuthority') {
        const compound = condition as Record<string, unknown>;
        if (
          !valuesEqual(row['provider'], compound['provider']) ||
          !valuesEqual(row['providerAuthority'], compound['providerAuthority'])
        ) {
          return false;
        }
        continue;
      }
      if (key === 'OR') {
        if (!(condition as Record<string, unknown>[]).some((branch) => this.matchesWhere(table, row, branch))) {
          return false;
        }
        continue;
      }
      if (table === 'order' && (key === 'workItems' || key === 'topUpFulfillments')) {
        const related = this.tables[key === 'workItems' ? 'workItem' : 'topUpFulfillment'];
        const exists = related.some((candidate) => valuesEqual(candidate['orderId'], row['id']));
        if ('none' in (condition as Record<string, unknown>) && exists) return false;
        continue;
      }
      if (table === 'payment' && key === 'refunds') {
        const exists = this.tables.refund.some((candidate) => valuesEqual(candidate['paymentId'], row['id']));
        if ('none' in (condition as Record<string, unknown>) && exists) return false;
        continue;
      }
      if (table === 'payment' && key === 'order') {
        const order = this.tables.order.find((candidate) => valuesEqual(candidate['id'], row['orderId']));
        if (order === undefined || !this.matchesWhere('order', order, condition as Record<string, unknown>)) return false;
        continue;
      }
      if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
        const operators = condition as Record<string, unknown>;
        if (Array.isArray(operators['in'])) {
          const candidates = operators['in'] as readonly unknown[];
          if (!candidates.some((candidate) => valuesEqual(row[key], candidate))) return false;
          continue;
        }
        let handled = false;
        if ('not' in operators) {
          if (valuesEqual(row[key], operators['not'])) return false;
          handled = true;
        }
        if (operators['lt'] instanceof Date) {
          if (!(row[key] instanceof Date) || (row[key] as Date).getTime() >= (operators['lt'] as Date).getTime()) return false;
          handled = true;
        }
        if (operators['gt'] instanceof Date) {
          if (!(row[key] instanceof Date) || (row[key] as Date).getTime() <= (operators['gt'] as Date).getTime()) return false;
          handled = true;
        }
        if (!handled) throw new Error(`Unsupported filter for "${key}" in the payments test database`);
        continue;
      }
      if (!valuesEqual(row[key], condition)) return false;
    }
    return true;
  }

  /** Mirrors the unique constraints the payment flow depends on. */
  assertUnique(name: TableName, row: Row, self: Row | null): void {
    const columns = [...(UNIQUE_COLUMNS[name] ?? [])];
    for (const existing of this.tables[name]) {
      if (existing === self) continue;
      for (const column of columns) {
        if (row[column] !== undefined && row[column] !== null && valuesEqual(existing[column], row[column])) {
          throw Object.assign(new Error(`Unique constraint failed on ${name}.${column}`), { code: 'P2002' });
        }
      }
      if (
        name === 'payment' &&
        row['providerAuthority'] !== undefined &&
        row['providerAuthority'] !== null &&
        valuesEqual(existing['provider'], row['provider']) &&
        valuesEqual(existing['providerAuthority'], row['providerAuthority'])
      ) {
        throw Object.assign(new Error('Unique constraint failed on Payment(provider, providerAuthority)'), {
          code: 'P2002',
        });
      }
    }
  }

  /** Rolls the whole store back when the callback throws, like a real transaction. */
  async $transaction<T>(callback: (transaction: PaymentDatabase) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(this.tables);
    try {
      return await callback(this);
    } catch (error) {
      for (const name of TABLE_NAMES) this.tables[name] = snapshot[name];
      throw error;
    }
  }

  paymentById(id: string): Row {
    const row = this.tables.payment.find((candidate) => candidate['id'] === id);
    if (row === undefined) throw new Error(`No payment ${id}`);
    return row;
  }
}

/** Statuses after which the bridge reports "already paid" instead of moving. */
const POST_PAYMENT: ReadonlySet<string> = new Set([
  'PAID',
  'FULFILLMENT_PENDING',
  'FULFILLING',
  'FULFILLED',
  'REFUND_PENDING',
  'REFUNDED',
]);

/**
 * The order side of the bridge, applying the real transition map to the fake
 * tables. Writes are recorded as `order.update` calls so a test can count them.
 */
export class FakeOrderBridge implements OrderPaymentBridge {
  constructor(private readonly db: FakePaymentDatabase) {}

  async markPaymentPending(orderId: string): Promise<OrderTransitionResult> {
    return this.move(orderId, 'PAYMENT_PENDING', false);
  }

  async markPaid(orderId: string): Promise<OrderTransitionResult> {
    return this.move(orderId, 'PAID', false);
  }

  async markPaidAfterClosure(orderId: string): Promise<OrderTransitionResult> {
    return this.move(orderId, 'PAID', true);
  }

  async markPaymentFailed(orderId: string): Promise<OrderTransitionResult> {
    return this.move(orderId, 'FAILED', false);
  }

  private move(orderId: string, next: OrderStatus, late: boolean): OrderTransitionResult {
    const row = this.db.tables.order.find((candidate) => candidate['id'] === orderId);
    if (row === undefined) throw new Error(`No order ${orderId}`);
    const from = row['status'] as OrderStatus;
    const result = { orderId, orderNumber: row['orderNumber'] as string };
    if (row['paidAt'] instanceof Date || POST_PAYMENT.has(from) || from === next) {
      return { ...result, status: from, changed: false };
    }
    const allowed = ALLOWED_TRANSITIONS[from].includes(next) || (late && (LATE_PAYMENT_TRANSITIONS[from]?.includes(next) ?? false));
    if (!allowed) throw new IllegalOrderTransition(from, next);
    const data: Row = { status: next, ...(next === 'PAID' ? { paidAt: new Date() } : {}) };
    this.db.record('order', 'update', { where: { id: orderId }, data });
    Object.assign(row, data);
    return { ...result, status: next, changed: true };
  }
}
