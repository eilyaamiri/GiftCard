import type {
  SupplierAvailability,
  SupplierAvailabilityResult,
  SupplierBalance,
  SupplierCatalogItem,
  SupplierDeliveryAsset,
  SupplierMoney,
  SupplierPrice,
  SupplierProvider,
  SupplierPurchaseRequest,
  SupplierPurchaseResult,
  SupplierTopUpCatalogRead,
  SupplierTopUpField,
  SupplierTopUpGame,
  SupplierTopUpOffer,
  SupplierTopUpUnreadableGame,
} from '../supplier-provider.interface';

const DEFAULT_BASE_URL = 'https://g4a4.com/wp-json/reseller/v1';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;

/** The venue's firewall answers an unrecognised User-Agent, even from an allow-listed IP, with an HTML page and status 200. */
const USER_AGENT = 'curl/8.5.0';

/** The docs promise a 429 but state no limit; reads wait it out, purchases never retry. */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 65_000;
const DEFAULT_RETRY_AFTER_MS = 2_000;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
const READ_RETRY_DELAYS_MS = [500, 1_500] as const;

/** A catalogue walk is one request per category and one per product, so keep it gentle. */
const CATALOG_CONCURRENCY = 2;

/** Bound on the in-process replay memory; one entry per purchase attempt. */
const MAX_REMEMBERED_PURCHASES = 1_000;

type JsonObject = Record<string, unknown>;

/** Adapter-owned failure. `code` is normalised; a raw provider message never travels inside it. */
export class G4a4SupplierError extends Error {
  readonly code: string;
  /** The venue's HTTP status, when it answered at all. */
  readonly httpStatus?: number;

  constructor(code: string, message: string, options?: { cause?: unknown; httpStatus?: number }) {
    super(message, options);
    this.name = 'G4a4SupplierError';
    this.code = code;
    if (options?.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

export interface G4a4SupplierProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  /**
   * The venue's category ids a catalogue walk covers. Empty or absent walks every
   * category, which also reaches accounts, boosting and the like: slow, and only
   * `code` (gift cards) or `topup` variations are kept either way.
   */
  readonly categoryIds?: readonly string[];
  readonly clock?: () => Date;
  /** The pause between retries; injectable so tests do not wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** The venue's ids are numeric; they become query values and path-free tokens, so hold them to that. */
const ID_PATTERN = /^\d{1,15}$/u;

function numericId(value: unknown): string | null {
  const text = trimmed(value);
  return text !== null && ID_PATTERN.test(text) ? text : null;
}

/**
 * This venue prices in IRT (toman). The amount is never converted here: the
 * interface says an adapter must not, and a toman figure read as rials or dollars
 * would misprice a sale by a factor nobody would catch. Integers arrive as JSON
 * numbers; a string may carry up to two decimals. Nothing goes through float math.
 */
function parseAmount(value: unknown, field: string): string {
  if (typeof value === 'number') {
    if (Number.isSafeInteger(value) && value >= 0) {
      return String(value);
    }
  } else if (typeof value === 'string' && /^\d{1,15}(?:\.\d{1,2})?$/u.test(value.trim())) {
    return value.trim();
  }
  throw new G4a4SupplierError('INVALID_RESPONSE', `${field} is not a usable amount`);
}

const CURRENCY_PATTERN = /^[A-Z]{3,4}$/u;

function money(amount: unknown, currency: unknown, field: string): SupplierMoney {
  const code = typeof currency === 'string' ? currency.trim().toUpperCase() : '';
  if (!CURRENCY_PATTERN.test(code)) {
    throw new G4a4SupplierError('INVALID_RESPONSE', `${field} has no usable currency`);
  }
  return { amount: parseAmount(amount, field), currency: code };
}

function optionalMoney(amount: unknown, currency: unknown, field: string): SupplierMoney | undefined {
  try {
    return money(amount, currency, field);
  } catch {
    return undefined;
  }
}

interface G4a4Response {
  readonly status: number;
  readonly payload: unknown;
  readonly retryAfterMs?: number;
}

/**
 * The venue's own answers worth telling apart. Its prose `message` is matched
 * against this fixed list and never copied, logged or returned.
 */
const KNOWN_MESSAGES: ReadonlyMap<string, string> = new Map([
  ['insufficient balance', 'INSUFFICIENT_BALANCE'],
  ['invalid api key', 'INVALID_API_KEY'],
]);

function normaliseErrorCode(response: G4a4Response, fallback: string): string {
  const payload = response.payload;
  if (isObject(payload)) {
    const known = KNOWN_MESSAGES.get(trimmed(payload['message'])?.toLowerCase() ?? '');
    if (known !== undefined) {
      return known;
    }
    const code = payload['code'];
    if (typeof code === 'string' && code.trim() !== '') {
      const safe = code.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 60);
      return `PROVIDER_${safe}`;
    }
  }
  return response.status === 403 ? 'PROVIDER_FORBIDDEN' : fallback;
}

/** The success envelope is `{ data: { status: 200, ... } }`. */
function dataOf(payload: unknown): JsonObject | null {
  return isObject(payload) && isObject(payload['data']) ? payload['data'] : null;
}

function retryAfterMs(response: Response): number | undefined {
  const raw = response.headers.get('retry-after');
  const seconds = raw === null ? Number.NaN : Number(raw);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return Math.min(Math.ceil(seconds * 1000), MAX_RETRY_AFTER_MS);
}

function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof G4a4SupplierError) || error.code !== 'NETWORK_ERROR') {
    return false;
  }
  const cause: unknown = error.cause;
  return !(isObject(cause) && cause['name'] === 'TimeoutError');
}

/**
 * Transport shared by both adapters: one key, one error envelope, one place
 * where the headers, the timeout and the 429 handling live.
 */
class G4a4Client {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly categoryIds: readonly string[];

  constructor(options: G4a4SupplierProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey === '') {
      throw new RangeError('G4A4 API key is required');
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError('G4A4 timeout must be a positive safe integer');
    }
    const categoryIds = (options.categoryIds ?? []).map((id) => id.trim()).filter((id) => id !== '');
    if (!categoryIds.every((id) => ID_PATTERN.test(id))) {
      throw new RangeError('G4A4 category ids must be numeric');
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = timeoutMs;
    this.categoryIds = categoryIds;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** One request, no retry. Purchases use this directly. `test_mode` is never sent: it would not buy anything. */
  async call(options: {
    method: 'GET' | 'POST';
    path: string;
    query?: Readonly<Record<string, string>>;
    body?: unknown;
  }): Promise<G4a4Response> {
    const headers: Record<string, string> = { 'api-key': this.apiKey, accept: 'application/json', 'user-agent': USER_AGENT };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    const query = options.query === undefined ? '' : `?${new URLSearchParams(options.query).toString()}`;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${options.path}${query}`, {
        method: options.method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new G4a4SupplierError('NETWORK_ERROR', 'G4A4 could not be reached', { cause: error });
    }

    let payload: unknown;
    try {
      payload = (await response.json()) as unknown;
    } catch {
      payload = undefined;
    }
    const wait = retryAfterMs(response);
    return { status: response.status, payload, ...(wait === undefined ? {} : { retryAfterMs: wait }) };
  }

  /**
   * A read that rides out throttling, a gateway hiccup, or a dropped connection.
   * A timeout is not retried: it has already spent the whole per-request budget.
   */
  async read(path: string, query?: Readonly<Record<string, string>>): Promise<G4a4Response> {
    let rateLimited = 0;
    let transient = 0;
    for (;;) {
      let response: G4a4Response;
      try {
        response = await this.call({ method: 'GET', path, ...(query === undefined ? {} : { query }) });
      } catch (error) {
        const delay = READ_RETRY_DELAYS_MS[transient];
        if (delay === undefined || !isRetryableNetworkError(error)) {
          throw error;
        }
        transient += 1;
        await this.sleep(delay);
        continue;
      }
      if (response.status === 429 && rateLimited < MAX_RATE_LIMIT_RETRIES) {
        rateLimited += 1;
        await this.sleep(response.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS);
        continue;
      }
      const delay = READ_RETRY_DELAYS_MS[transient];
      if (delay !== undefined && RETRYABLE_STATUSES.has(response.status)) {
        transient += 1;
        await this.sleep(delay);
        continue;
      }
      return response;
    }
  }

  expectOk(response: G4a4Response, code: string): JsonObject {
    if (response.status !== 200) {
      throw new G4a4SupplierError(
        normaliseErrorCode(response, code),
        `G4A4 refused the request with HTTP ${String(response.status)}`,
        { httpStatus: response.status },
      );
    }
    const data = dataOf(response.payload);
    if (data === null) {
      throw new G4a4SupplierError('INVALID_RESPONSE', 'G4A4 answered without a data block');
    }
    return data;
  }

  async balance(clock: () => Date): Promise<SupplierBalance> {
    const data = this.expectOk(await this.read('/get-balance'), 'BALANCE_UNAVAILABLE');
    const { amount, currency } = money(data['balance'], data['currency'], 'balance');
    return { amount, currency, observedAt: clock() };
  }

  async categories(): Promise<readonly { readonly id: string; readonly name: string }[]> {
    if (this.categoryIds.length > 0) {
      return this.categoryIds.map((id) => ({ id, name: id }));
    }
    const data = this.expectOk(await this.read('/product/get-categories'), 'CATALOG_UNAVAILABLE');
    return rows(data['categories'], 'categories').flatMap((row) => {
      const id = numericId(row['id']);
      return id === null ? [] : [{ id, name: trimmed(row['name']) ?? id }];
    });
  }

  /** `null` for a 404: the venue may still list a category it no longer serves. */
  async products(categoryId: string): Promise<readonly { readonly id: string; readonly name: string }[] | null> {
    const response = await this.read('/product/get-products', { category_id: categoryId });
    if (response.status === 404) {
      return null;
    }
    const data = this.expectOk(response, 'CATALOG_UNAVAILABLE');
    return rows(data['products'], 'products').flatMap((row) => {
      const id = numericId(row['id']);
      return id === null ? [] : [{ id, name: trimmed(row['name']) ?? id }];
    });
  }

  async product(productId: string): Promise<{ readonly name: string; readonly variations: readonly JsonObject[] } | null> {
    const response = await this.read('/product/get-product', { product_id: productId });
    if (response.status === 404) {
      return null;
    }
    const product = this.expectOk(response, 'CATALOG_UNAVAILABLE')['product'];
    if (!isObject(product)) {
      throw new G4a4SupplierError('INVALID_RESPONSE', 'G4A4 product payload is unusable');
    }
    return { name: trimmed(product['name']) ?? productId, variations: rows(product['variations'], 'variations') };
  }

  async variation(variationId: string): Promise<JsonObject> {
    const response = await this.read('/product/get-variation', { variation_id: variationId });
    if (response.status === 404) {
      throw new G4a4SupplierError('OFFER_NOT_FOUND', 'G4A4 variation does not exist', { httpStatus: 404 });
    }
    const variation = this.expectOk(response, 'CATALOG_UNAVAILABLE')['variation'];
    if (!isObject(variation)) {
      throw new G4a4SupplierError('INVALID_RESPONSE', 'G4A4 variation payload is unusable');
    }
    return variation;
  }

  /** `GET /order/get-order`, answered as `data.order`. */
  async order(orderId: string): Promise<{ status: number; order: JsonObject | null; response: G4a4Response }> {
    const response = await this.read('/order/get-order', { order_id: orderId });
    const data = dataOf(response.payload);
    const order = data !== null && isObject(data['order']) ? data['order'] : null;
    return { status: response.status, order, response };
  }
}

/** A list the venue returned; anything else is a broken answer, not an empty catalogue. */
function rows(value: unknown, what: string): readonly JsonObject[] {
  if (!Array.isArray(value)) {
    throw new G4a4SupplierError('INVALID_RESPONSE', `G4A4 ${what} was not a list`);
  }
  return value.filter(isObject);
}

async function mapWithConcurrency<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await run(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/* ============================================================================
 * Variations
 * ==========================================================================*/

/** What a variation hands over: `code` is a gift card, `topup` credits an account, `manual` is a person. */
function deliveryTypeOf(variation: JsonObject): string | null {
  return trimmed(variation['delivery_type'])?.toLowerCase() ?? null;
}

function inStock(variation: JsonObject): boolean {
  return variation['in_stock'] === true;
}

function variationPrice(variation: JsonObject): SupplierMoney {
  return money(variation['price'], variation['currency'], 'price');
}

/** `pa_region` is the venue's own region attribute; a variation without one is not regional. */
function regionOf(variation: JsonObject): string {
  const attributes = variation['attributes'];
  for (const attribute of Array.isArray(attributes) ? attributes.filter(isObject) : []) {
    if (trimmed(attribute['key']) === 'pa_region') {
      const value = trimmed(attribute['value']);
      if (value !== null) {
        return value.toUpperCase();
      }
    }
  }
  return 'GLOBAL';
}

/**
 * Anything that reads as a secret the customer would have to hand us. A false
 * positive only hides a game an operator can look at; a false negative would
 * ask a customer for their password, so this errs wide. The venue labels fields
 * in Persian, so the Persian words are listed beside the English ones.
 */
const CREDENTIAL_PATTERN =
  /pass(?:word|wd|code)?|pwd|(?:^|[^a-z])pin(?:[^a-z]|$)|otp|2fa|two[-_ ]?factor|verification[-_ ]?code|auth(?:entication)?[-_ ]?code|backup[-_ ]?code|recovery|security[-_ ]?(?:code|question|answer)|secret|token|رمز|گذرواژه|پسورد|کلمه عبور|کد تایید|کد تأیید|کد احراز|کد پشتیبان|بازیابی/iu;

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/gu, ' ').trim();
  return spaced === '' ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isFalse(value: unknown): boolean {
  return value === false || value === 0 || value === '0' || value === 'false';
}

/**
 * `fields[]` is `{ data_name, type, required, name }`. A field of a kind we cannot
 * collect (a file upload, a measured amount) that the venue requires makes the
 * game unsellable, which is what `credential` means to everything downstream.
 * An optional one of those kinds is simply not asked for.
 */
function parseFields(variation: JsonObject): readonly SupplierTopUpField[] {
  const list = variation['fields'];
  const seen = new Set<string>();
  const fields: SupplierTopUpField[] = [];
  for (const entry of Array.isArray(list) ? list.filter(isObject) : []) {
    const key = trimmed(entry['data_name']);
    if (key === null || seen.has(key)) {
      continue;
    }
    const label = trimmed(entry['name']) ?? humanise(key);
    const type = (trimmed(entry['type']) ?? 'text').toLowerCase();
    const required = !isFalse(entry['required']);
    const uncollectable = type === 'upload' || type === 'measure_input';
    if (uncollectable && !required) {
      continue;
    }
    seen.add(key);
    fields.push({
      key,
      label,
      /* The docs show no option lists, so every field is typed by the customer. */
      type: 'TEXT',
      required,
      credential: uncollectable || type === 'password' || CREDENTIAL_PATTERN.test(key) || CREDENTIAL_PATTERN.test(label),
    });
  }
  return fields;
}

/* ============================================================================
 * Orders
 * ==========================================================================*/

/**
 * Purchases have no venue-side idempotency: `client_reference` is for looking an
 * order up afterwards, and nothing says a repeat is refused. A second POST would
 * be a second charge. So, as with the other no-idempotency venues:
 *
 *  - calls racing on one key within this process share a single request;
 *  - once a request has gone out, its outcome is remembered and replayed for the
 *    same key instead of being sent again (this covers `UNKNOWN` too);
 *  - across a restart nothing remembers, so the caller must never resend a key
 *    whose answer was `UNKNOWN` — a human looks the order up by `client_reference`.
 *
 * These adapters therefore never set `idempotentPurchases`.
 */
class PurchaseMemory {
  private readonly inFlight = new Map<string, Promise<SupplierPurchaseResult>>();
  private readonly settled = new Map<string, SupplierPurchaseResult>();

  async run(
    key: string,
    attempt: () => Promise<{ result: SupplierPurchaseResult; sent: boolean }>,
  ): Promise<SupplierPurchaseResult> {
    const remembered = this.settled.get(key);
    if (remembered !== undefined) {
      return remembered;
    }
    const running = this.inFlight.get(key);
    if (running !== undefined) {
      return running;
    }

    const promise = attempt()
      .then(({ result, sent }) => {
        /* A refusal before anything was sent, or a throttled call, charged nothing and may be tried again. */
        if (sent && result.failureCode !== 'RATE_LIMITED') {
          this.settled.set(key, result);
          if (this.settled.size > MAX_REMEMBERED_PURCHASES) {
            const oldest = this.settled.keys().next();
            if (!oldest.done) {
              this.settled.delete(oldest.value);
            }
          }
        }
        return result;
      })
      .finally(() => {
        this.inFlight.delete(key);
      });
    this.inFlight.set(key, promise);
    return promise;
  }
}

/** What a POST answer means. `UNKNOWN` unless the venue plainly refused. */
function classifyPostFailure(response: G4a4Response): SupplierPurchaseResult {
  if (response.status === 429) {
    /* The limiter refuses the call before order logic runs: nothing charged. */
    return { status: 'FAILED', failureCode: 'RATE_LIMITED' };
  }
  if (response.status >= 400 && response.status < 500) {
    return { status: 'FAILED', failureCode: normaliseErrorCode(response, 'PROVIDER_REJECTED') };
  }
  /* 5xx or an unreadable body: the order may well have been placed and charged. */
  return { status: 'UNKNOWN', failureCode: normaliseErrorCode(response, 'PROVIDER_UNAVAILABLE') };
}

/**
 * `POST /order/add-order` answers `{ order_id, total, currency }` and no status, so
 * an accepted order is PENDING until `get-order` says otherwise. The poller that
 * owns the order reads it from there.
 */
function acceptedOrder(payload: unknown): SupplierPurchaseResult {
  const data = dataOf(payload);
  const providerReference = data === null ? null : numericId(data['order_id']);
  if (data === null || providerReference === null) {
    /* Charged, perhaps, but nothing to look the order up by: a human must check. */
    return { status: 'UNKNOWN', failureCode: 'ORDER_ID_MISSING' };
  }
  const cost = optionalMoney(data['total'], data['currency'], 'total');
  return { status: 'PENDING', providerReference, ...(cost === undefined ? {} : { cost }) };
}

async function placeOrder(
  client: G4a4Client,
  body: Readonly<Record<string, unknown>>,
): Promise<{ result: SupplierPurchaseResult; sent: boolean }> {
  let response: G4a4Response;
  try {
    response = await client.call({ method: 'POST', path: '/order/add-order', body });
  } catch {
    /* The request may have reached the venue before the connection died. */
    return { result: { status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' }, sent: true };
  }
  if (response.status === 200 || response.status === 201) {
    return { result: acceptedOrder(response.payload), sent: true };
  }
  return { result: classifyPostFailure(response), sent: true };
}

/**
 * The venue documents `processing` and `completed`. The rest are the order
 * states of the store it runs on, mapped on that assumption: a refused or
 * returned order is a settled failure, and anything unrecognised goes to a human.
 */
function mapOrderStatus(status: string | null): SupplierPurchaseResult['status'] {
  switch (status) {
    case 'completed':
      return 'SUCCEEDED';
    case 'processing':
    case 'pending':
    case 'on-hold':
      return 'PENDING';
    case 'failed':
    case 'cancelled':
    case 'canceled':
    case 'refunded':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

type Delivery = { readonly asset: SupplierDeliveryAsset } | { readonly failureCode: string };

/** The status block shared by both products; `deliver` supplies the asset for a completed order. */
function settleOrder(order: JsonObject | null, deliver: (order: JsonObject) => Delivery): SupplierPurchaseResult {
  if (order === null) {
    return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
  }
  const providerReference = numericId(order['id']);
  if (providerReference === null) {
    return { status: 'UNKNOWN', failureCode: 'ORDER_ID_MISSING' };
  }
  const rawStatus = trimmed(order['status'])?.toLowerCase() ?? null;
  const status = mapOrderStatus(rawStatus);
  const cost = optionalMoney(order['total'], order['currency'], 'total');
  const base = { providerReference, ...(cost === undefined ? {} : { cost }) };

  if (status === 'FAILED') {
    const word = rawStatus === 'canceled' ? 'cancelled' : (rawStatus ?? 'failed');
    return { ...base, status, failureCode: `G4A4_${word.toUpperCase().replace(/[^A-Z]/gu, '_')}` };
  }
  if (status !== 'SUCCEEDED') {
    return { ...base, status };
  }

  const delivery = deliver(order);
  if ('failureCode' in delivery) {
    /* Charged and completed, but nothing usable to hand over: a human must look. */
    return { ...base, status: 'UNKNOWN', failureCode: delivery.failureCode };
  }
  return { ...base, status: 'SUCCEEDED', asset: delivery.asset };
}

/** The docs' own extraction rule: the code sits inside `copyToClipboard(\`...\`)` in a note's HTML. */
const COPY_TO_CLIPBOARD = /copyToClipboard\(`([^`]+)`\)/gu;
const MAX_CODE_LENGTH = 512;

/** Distinct codes found across an order's notes, in order. Never logged or echoed. */
function extractCodes(notes: unknown): readonly string[] {
  const texts = Array.isArray(notes)
    ? notes.map((note) => (isObject(note) ? trimmed(note['note']) : trimmed(note)))
    : [trimmed(notes)];
  const found = new Set<string>();
  for (const text of texts) {
    if (text === null) {
      continue;
    }
    for (const match of text.matchAll(COPY_TO_CLIPBOARD)) {
      const code = (match[1] ?? '').trim();
      if (code !== '' && code.length <= MAX_CODE_LENGTH && !/[\r\n<>]/u.test(code)) {
        found.add(code);
      }
    }
  }
  return [...found];
}

async function settledStatus(
  client: G4a4Client,
  providerReference: string,
  deliver: (order: JsonObject) => Delivery,
): Promise<SupplierPurchaseResult> {
  const reference = providerReference.trim();
  if (!ID_PATTERN.test(reference)) {
    return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
  }
  const { status, order, response } = await client.order(reference);
  if (status === 404) {
    return { status: 'UNKNOWN', providerReference, failureCode: 'ORDER_NOT_FOUND' };
  }
  if (status !== 200) {
    return { status: 'UNKNOWN', providerReference, failureCode: normaliseErrorCode(response, 'STATUS_UNAVAILABLE') };
  }
  return settleOrder(order, deliver);
}

/* ============================================================================
 * Gift cards
 * ==========================================================================*/

/**
 * G4A4 (g4a4.com) gift-card adapter, `Supplier.code = g4a4`.
 *
 * Built from the published Postman reference "G4A4-Reseller" (fetched
 * 2026-11-04); no live account was called while writing it, so every shape is
 * **inferred from documentation**. In particular the order statuses beyond
 * `processing` and `completed`, the 404 for a missing order, and a delivered
 * code with a PIN are undocumented. Do not enable `G4A4_GIFTCARD_ENABLED` before a
 * read-only check against the real account (`getCatalog`, `getBalance`) and a
 * supervised low-value order.
 *
 * Provider SKU is the venue's variation id. Every amount this venue reports is
 * IRT (toman), and is reported as such: the quote engine prices dollar costs only,
 * so these offers cannot be quoted until a rial-cost rule exists.
 *
 * Only quantity 1 is bought, and only a variation the venue delivers as `code`.
 * A completed order must carry exactly one distinct code in its notes.
 */
export class G4a4GiftCardSupplierProvider implements SupplierProvider {
  readonly key = 'g4a4';

  private readonly client: G4a4Client;
  private readonly clock: () => Date;
  private readonly purchases = new PurchaseMemory();

  constructor(options: G4a4SupplierProviderOptions) {
    this.client = new G4a4Client(options);
    this.clock = options.clock ?? (() => new Date());
  }

  getBalance(): Promise<SupplierBalance> {
    return this.client.balance(this.clock);
  }

  /** In-stock `code` variations only. All-or-nothing: a partial walk would look like a delisting. */
  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    const categories = await this.client.categories();
    const productLists = await mapWithConcurrency(categories, CATALOG_CONCURRENCY, (category) =>
      this.client.products(category.id),
    );
    const productIds = [...new Set(productLists.flatMap((list) => (list ?? []).map((product) => product.id)))];
    const products = await mapWithConcurrency(productIds, CATALOG_CONCURRENCY, (id) => this.client.product(id));

    const items: SupplierCatalogItem[] = [];
    for (const product of products) {
      if (product === null) {
        continue;
      }
      for (const variation of product.variations) {
        const id = numericId(variation['id']);
        if (id === null || deliveryTypeOf(variation) !== 'code' || !inStock(variation)) {
          continue;
        }
        try {
          items.push({
            providerSku: id,
            name: trimmed(variation['name']) ?? id,
            brand: product.name,
            region: regionOf(variation),
            faceValue: variationPrice(variation),
            assetType: 'CODE',
          });
        } catch {
          /* No readable price means it cannot be quoted; leaving it out delists it. */
        }
      }
    }
    return items;
  }

  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const id = this.variationId(providerSku);
    return { providerSku, cost: variationPrice(await this.client.variation(id)), observedAt: this.clock() };
  }

  /**
   * A transport failure is UNKNOWN, never UNAVAILABLE: an unreachable venue is
   * not a sold-out one, and reporting it as sold out would silently divert
   * orders to a costlier supplier. A variation this adapter could not buy is
   * UNAVAILABLE, so a mis-mapped SKU is skipped rather than charged.
   */
  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    let availability: SupplierAvailability;
    try {
      const variation = await this.client.variation(this.variationId(providerSku));
      availability = inStock(variation) && deliveryTypeOf(variation) === 'code' ? 'AVAILABLE' : 'UNAVAILABLE';
    } catch (error) {
      availability =
        error instanceof G4a4SupplierError && (error.code === 'OFFER_NOT_FOUND' || error.code === 'INVALID_PROVIDER_SKU')
          ? 'UNAVAILABLE'
          : 'UNKNOWN';
    }
    return { providerSku, availability, observedAt: this.clock() };
  }

  async purchase(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResult> {
    if (request.quantity !== 1) {
      return { status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' };
    }
    const identifier = request.idempotencyKey.trim();
    if (identifier === '') {
      return { status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' };
    }
    let variationId: string;
    try {
      variationId = this.variationId(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    return this.purchases.run(identifier, async () => {
      /* A read before the charge: a SKU pointing at a manual or out-of-stock variation must not be bought. */
      let variation: JsonObject;
      try {
        variation = await this.client.variation(variationId);
      } catch (error) {
        const failureCode = error instanceof G4a4SupplierError && error.code === 'OFFER_NOT_FOUND' ? 'OFFER_NOT_FOUND' : 'VARIATION_UNREADABLE';
        return { result: { status: 'FAILED', failureCode }, sent: false };
      }
      if (deliveryTypeOf(variation) !== 'code') {
        return { result: { status: 'FAILED', failureCode: 'DELIVERY_TYPE_MISMATCH' }, sent: false };
      }
      if (!inStock(variation)) {
        return { result: { status: 'FAILED', failureCode: 'OUT_OF_STOCK' }, sent: false };
      }
      if (parseFields(variation).some((field) => field.required)) {
        return { result: { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_REQUIRED' }, sent: false };
      }
      return placeOrder(this.client, { variation_id: variationId, quantity: 1, client_reference: identifier });
    });
  }

  getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    return settledStatus(this.client, providerReference, (order): Delivery => {
      const codes = extractCodes(order['notes']);
      const [code] = codes;
      if (code === undefined) {
        return { failureCode: 'DELIVERY_MISSING' };
      }
      return codes.length === 1 ? { asset: { assetType: 'CODE', code } } : { failureCode: 'DELIVERY_AMBIGUOUS' };
    });
  }

  private variationId(providerSku: string): string {
    const id = numericId(providerSku);
    if (id === null) {
      throw new G4a4SupplierError('INVALID_PROVIDER_SKU', 'G4A4 provider SKU must be a numeric variation id');
    }
    return id;
  }
}

/* ============================================================================
 * Game top-ups
 * ==========================================================================*/

/** `product_id:variation_id` — both halves are the venue's own ids. */
const TOPUP_SKU_PATTERN = /^(\d{1,15}):(\d{1,15})$/u;

export interface G4a4TopUpOfferRef {
  readonly productId: string;
  readonly variationId: string;
}

export function parseG4a4TopUpProviderSku(providerSku: string): G4a4TopUpOfferRef {
  const match = TOPUP_SKU_PATTERN.exec(providerSku.trim());
  if (match === null) {
    throw new G4a4SupplierError(
      'INVALID_PROVIDER_SKU',
      'G4A4 top-up provider SKU must look like `<product_id>:<variation_id>`',
    );
  }
  const [, productId = '', variationId = ''] = match;
  return { productId, variationId };
}

export function formatG4a4TopUpProviderSku(productId: string, variationId: string): string {
  return `${productId}:${variationId}`;
}

/**
 * G4A4 (g4a4.com) game top-up adapter, `Supplier.code = g4a4-topup`.
 *
 * Same source and same caveat as the gift-card adapter: built from the
 * published docs, nothing verified against a live response. A game here is a
 * venue product and an offer is one of its `topup` variations; provider SKU is
 * `<product_id>:<variation_id>`. The order's `data` carries the variation's
 * declared fields under their own `data_name` keys, which the catalogue import
 * stores and the quote path sends back as `accountFields`.
 *
 * A top-up credits the player's own account, so the asset is `DIRECT_TOPUP` and
 * carries no secret. A game whose variations ask for a password (or a file we
 * cannot collect) is flagged `requiresCredentials` and is never sold.
 */
export class G4a4TopUpSupplierProvider implements SupplierProvider {
  readonly key = 'g4a4-topup';

  private readonly client: G4a4Client;
  private readonly clock: () => Date;
  private readonly purchases = new PurchaseMemory();

  constructor(options: G4a4SupplierProviderOptions) {
    this.client = new G4a4Client(options);
    this.clock = options.clock ?? (() => new Date());
  }

  getBalance(): Promise<SupplierBalance> {
    return this.client.balance(this.clock);
  }

  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    const games = await this.getTopUpCatalog();
    return games.flatMap((game) =>
      game.offers.flatMap((offer): SupplierCatalogItem[] =>
        offer.cost === null
          ? []
          : [
              {
                providerSku: formatG4a4TopUpProviderSku(game.categoryId, offer.offerId),
                name: offer.name,
                region: game.region,
                faceValue: offer.cost,
                assetType: 'DIRECT_TOPUP',
                groupLabel: game.name,
                ...(game.fields.length === 0 ? {} : { requiredAccountFields: game.fields.map((field) => field.key) }),
              },
            ],
      ),
    );
  }

  /** All-or-nothing: the availability sync delists whatever is missing, so a partial answer would take games off sale. */
  async getTopUpCatalog(): Promise<readonly SupplierTopUpGame[]> {
    return (await this.collect(false)).games;
  }

  /** The import's read: a product that still fails after the retries is reported, not fatal to the rest. */
  async readTopUpCatalog(): Promise<SupplierTopUpCatalogRead> {
    return this.collect(true);
  }

  private async collect(tolerant: boolean): Promise<SupplierTopUpCatalogRead> {
    const categories = await this.client.categories();

    type Outcome<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: G4a4SupplierError };
    const attempt = async <T>(run: () => Promise<T>): Promise<Outcome<T>> => {
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        if (!tolerant || !(error instanceof G4a4SupplierError)) {
          throw error;
        }
        return { ok: false, error };
      }
    };

    const unreadable: SupplierTopUpUnreadableGame[] = [];
    let firstError: G4a4SupplierError | null = null;
    let attempted = 0;
    const note = (id: string, name: string, error: G4a4SupplierError): void => {
      firstError ??= error;
      unreadable.push({ categoryId: id, name, failureCode: error.code });
    };

    const listings = await mapWithConcurrency(categories, CATALOG_CONCURRENCY, (category) =>
      attempt(() => this.client.products(category.id)),
    );
    const products = new Map<string, string>();
    attempted += categories.length;
    listings.forEach((listing, index) => {
      const category = categories[index];
      if (category === undefined) {
        return;
      }
      if (!listing.ok) {
        note(category.id, category.name, listing.error);
        return;
      }
      for (const product of listing.value ?? []) {
        products.set(product.id, product.name);
      }
    });

    const productIds = [...products.keys()];
    attempted += productIds.length;
    const details = await mapWithConcurrency(productIds, CATALOG_CONCURRENCY, (id) =>
      attempt(() => this.client.product(id)),
    );

    const games: SupplierTopUpGame[] = [];
    details.forEach((detail, index) => {
      const id = productIds[index];
      if (id === undefined) {
        return;
      }
      if (!detail.ok) {
        note(id, products.get(id) ?? id, detail.error);
        return;
      }
      const game = detail.value === null ? null : this.toGame(id, detail.value);
      if (game !== null) {
        games.push(game);
      }
    });

    if (firstError !== null && unreadable.length === attempted) {
      throw firstError;
    }
    return { games, unreadable };
  }

  /** A product with no in-stock `topup` variation is not a game this adapter sells. */
  private toGame(productId: string, product: { name: string; variations: readonly JsonObject[] }): SupplierTopUpGame | null {
    const variations = product.variations.filter((variation) => deliveryTypeOf(variation) === 'topup');
    if (variations.length === 0) {
      return null;
    }

    const fieldsByKey = new Map<string, SupplierTopUpField>();
    for (const variation of variations) {
      for (const field of parseFields(variation)) {
        const known = fieldsByKey.get(field.key);
        fieldsByKey.set(
          field.key,
          known === undefined
            ? field
            : { ...known, required: known.required || field.required, credential: known.credential || field.credential },
        );
      }
    }
    const fields = [...fieldsByKey.values()];

    const offers = variations.flatMap((variation): SupplierTopUpOffer[] => {
      const offerId = numericId(variation['id']);
      if (offerId === null || !inStock(variation)) {
        return [];
      }
      return [{ offerId, name: trimmed(variation['name']) ?? offerId, cost: optionalMoney(variation['price'], variation['currency'], 'price') ?? null }];
    });
    if (offers.length === 0) {
      return null;
    }

    return {
      categoryId: productId,
      name: product.name,
      region: regionOf(variations[0] as JsonObject),
      note: null,
      imageUrl: null,
      fields,
      offers,
      requiresCredentials: fields.some((field) => field.credential),
    };
  }

  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const ref = parseG4a4TopUpProviderSku(providerSku);
    return { providerSku, cost: variationPrice(await this.client.variation(ref.variationId)), observedAt: this.clock() };
  }

  /** Transport failure is UNKNOWN; a variation that is gone, sold out, or not a top-up is UNAVAILABLE. */
  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    let availability: SupplierAvailability;
    try {
      const ref = parseG4a4TopUpProviderSku(providerSku);
      const variation = await this.client.variation(ref.variationId);
      availability = inStock(variation) && deliveryTypeOf(variation) === 'topup' ? 'AVAILABLE' : 'UNAVAILABLE';
    } catch (error) {
      availability =
        error instanceof G4a4SupplierError && (error.code === 'OFFER_NOT_FOUND' || error.code === 'INVALID_PROVIDER_SKU')
          ? 'UNAVAILABLE'
          : 'UNKNOWN';
    }
    return { providerSku, availability, observedAt: this.clock() };
  }

  async purchase(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResult> {
    if (request.quantity !== 1) {
      return { status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' };
    }
    const identifier = request.idempotencyKey.trim();
    if (identifier === '') {
      return { status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' };
    }
    const accountFields = request.accountFields ?? {};
    if (Object.keys(accountFields).length === 0) {
      return { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' };
    }
    let ref: G4a4TopUpOfferRef;
    try {
      ref = parseG4a4TopUpProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    return this.purchases.run(identifier, async () => {
      /* A read before the charge: it also tells us which `data` keys this variation declares. */
      let variation: JsonObject;
      try {
        variation = await this.client.variation(ref.variationId);
      } catch (error) {
        const failureCode = error instanceof G4a4SupplierError && error.code === 'OFFER_NOT_FOUND' ? 'OFFER_NOT_FOUND' : 'VARIATION_UNREADABLE';
        return { result: { status: 'FAILED', failureCode }, sent: false };
      }
      if (deliveryTypeOf(variation) !== 'topup') {
        return { result: { status: 'FAILED', failureCode: 'DELIVERY_TYPE_MISMATCH' }, sent: false };
      }
      if (!inStock(variation)) {
        return { result: { status: 'FAILED', failureCode: 'OUT_OF_STOCK' }, sent: false };
      }

      const declared = parseFields(variation);
      if (declared.some((field) => field.credential)) {
        /* Never reached through the storefront; refused here as well so a password cannot be sent by accident. */
        return { result: { status: 'FAILED', failureCode: 'CREDENTIALS_REQUIRED' }, sent: false };
      }
      const data: Record<string, string> = {};
      for (const field of declared) {
        const value = accountFields[field.key]?.trim() ?? '';
        if (value !== '') {
          data[field.key] = value;
        } else if (field.required) {
          return { result: { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' }, sent: false };
        }
      }

      return placeOrder(this.client, {
        variation_id: ref.variationId,
        quantity: 1,
        client_reference: identifier,
        data,
      });
    });
  }

  getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    /* The order echoes no account, so a status poll cannot name one. */
    return settledStatus(
      this.client,
      providerReference,
      (): Delivery => ({ asset: { assetType: 'DIRECT_TOPUP', accountReference: 'credited' } }),
    );
  }
}
