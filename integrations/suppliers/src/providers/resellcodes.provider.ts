import type {
  SupplierAvailability,
  SupplierAvailabilityResult,
  SupplierBalance,
  SupplierCatalogItem,
  SupplierDeliveryAsset,
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

const DEFAULT_BASE_URL = 'https://resell.codes/api/v1';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;

/** Every money field this venue documents is a decimal string with up to 4 decimals. */
const MONEY_SCALE = 4;
const MONEY_UNIT = 10n ** BigInt(MONEY_SCALE);

/**
 * New accounts get 30 requests a minute, and a catalogue walk is one request
 * per category. Reads wait out a 429 for the `Retry-After` the venue states,
 * up to this many times and never longer than the cap. Purchases never retry.
 */
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 65_000;
const DEFAULT_RETRY_AFTER_MS = 2_000;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([502, 503, 504]);
const CATALOG_RETRY_DELAYS_MS = [500, 1_500] as const;

/** Bound on the in-process replay memory; one entry per purchase attempt. */
const MAX_REMEMBERED_PURCHASES = 1_000;

type JsonObject = Record<string, unknown>;

/** Adapter-owned failure. `code` is normalised; a raw provider message never travels inside it. */
export class ResellCodesSupplierError extends Error {
  readonly code: string;
  /** The venue's HTTP status, when it answered at all. */
  readonly httpStatus?: number;

  constructor(code: string, message: string, options?: { cause?: unknown; httpStatus?: number }) {
    super(message, options);
    this.name = 'ResellCodesSupplierError';
    this.code = code;
    if (options?.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

export interface ResellCodesSupplierProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
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

function firstString(source: JsonObject, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = trimmed(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/** `category_id:item_id` — both halves are the venue's own ids. */
const PROVIDER_SKU_PATTERN = /^([^:]+):([^:]+)$/u;

export interface ResellCodesOfferRef {
  readonly categoryId: string;
  readonly itemId: string;
}

export function parseResellCodesProviderSku(providerSku: string): ResellCodesOfferRef {
  const match = PROVIDER_SKU_PATTERN.exec(providerSku.trim());
  if (match === null) {
    throw new ResellCodesSupplierError(
      'INVALID_PROVIDER_SKU',
      'ReSellCodes provider SKU must look like `<category_id>:<card_or_offer_id>`',
    );
  }
  const [, categoryId = '', itemId = ''] = match;
  return { categoryId, itemId };
}

export function formatResellCodesProviderSku(categoryId: string, itemId: string): string {
  return `${categoryId}:${itemId}`;
}

/** Parses one of this venue's amount strings into fixed point. Never goes through a JS number. */
function parseAmount(value: unknown, field: string): bigint {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{1,12}(?:\.\d{1,4})?$/u.test(text)) {
    throw new ResellCodesSupplierError('INVALID_RESPONSE', `${field} is not a usable amount`);
  }
  const [whole = '0', fraction = ''] = text.split('.');
  return BigInt(whole) * MONEY_UNIT + BigInt(fraction.padEnd(MONEY_SCALE, '0'));
}

function formatAmount(scaled: bigint): string {
  const whole = scaled / MONEY_UNIT;
  const fraction = (scaled % MONEY_UNIT).toString().padStart(MONEY_SCALE, '0');
  return `${whole}.${fraction}`;
}

function usd(value: unknown, field: string): { amount: string; currency: 'USD' } {
  return { amount: formatAmount(parseAmount(value, field)), currency: 'USD' };
}

/** The venue's `error.type`, reduced to a safe token. Its prose `message` is never read. */
function normaliseErrorCode(payload: unknown, fallback: string): string {
  const error = isObject(payload) ? payload['error'] : null;
  const type = isObject(error) ? trimmed(error['type']) : null;
  if (type === null) {
    return fallback;
  }
  const safe = type.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 60);
  return safe === '' ? fallback : `PROVIDER_${safe}`;
}

/** The documented `fail_code` values; anything else collapses to a generic code. */
const FAIL_CODES: ReadonlySet<string> = new Set([
  'out_of_stock',
  'stock_short',
  'price_changed',
  'offer_gone',
  'account_problem',
  'region_restricted',
  'limit_exceeded',
  'timed_out',
  'cancelled',
  'declined',
]);

function mapFailCode(value: unknown): string {
  const code = trimmed(value)?.toLowerCase() ?? null;
  return code !== null && FAIL_CODES.has(code) ? `RESELL_${code.toUpperCase()}` : 'PROVIDER_DECLINED';
}

function mapOrderStatus(status: string | null): SupplierPurchaseResult['status'] {
  switch (status) {
    case 'completed':
      return 'SUCCEEDED';
    case 'created':
    case 'processing':
      return 'PENDING';
    /* Every `fail_code` comes with an automatic refund, so `refund` is a settled failure too. */
    case 'failed':
    case 'refund':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

/** Order numbers become URL path segments, so they are held to a strict shape. */
const ORDER_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/u;

/**
 * Anything that reads as a secret the customer would have to hand us. A false
 * positive only hides a game an operator can look at; a false negative would
 * ask a customer for their password, so this errs wide.
 */
const CREDENTIAL_PATTERN =
  /pass(?:word|wd|code)?|pwd|(?:^|[^a-z])pin(?:[^a-z]|$)|otp|2fa|two[-_ ]?factor|verification[-_ ]?code|auth(?:entication)?[-_ ]?code|backup[-_ ]?code|recovery|security[-_ ]?(?:code|question|answer)|secret|token/iu;

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/gu, ' ').trim();
  return spaced === '' ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The documented shape is `fields: [{ key, label, type }]`. An entry without a key is skipped, not guessed. */
function parseFields(source: JsonObject): readonly SupplierTopUpField[] {
  const list = source['fields'];
  if (!Array.isArray(list)) {
    return [];
  }
  const seen = new Set<string>();
  const fields: SupplierTopUpField[] = [];
  for (const entry of list) {
    if (!isObject(entry)) {
      continue;
    }
    const key = trimmed(entry['key']);
    if (key === null || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const label = trimmed(entry['label']) ?? humanise(key);
    const rawType = (trimmed(entry['type']) ?? 'text').toLowerCase();
    fields.push({
      key,
      label,
      /* The docs give no option lists, so every field is typed by the customer. */
      type: 'TEXT',
      required: true,
      credential: rawType === 'password' || CREDENTIAL_PATTERN.test(key) || CREDENTIAL_PATTERN.test(label),
    });
  }
  return fields;
}

function parseImageUrl(source: JsonObject): string | null {
  const url = trimmed(source['image']);
  return url !== null && url.startsWith('https://') && url.length <= 2048 ? url : null;
}

interface ResellCodesResponse {
  readonly status: number;
  readonly payload: unknown;
  /** The venue's `Retry-After`, in milliseconds, when it sent a usable one. */
  readonly retryAfterMs?: number;
}

/**
 * Transport shared by both products: one key, one rate limit, one error
 * envelope. Both adapters go through it so the headers, the timeout and the
 * 429 handling cannot drift apart.
 */
class ResellCodesClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ResellCodesSupplierProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey === '') {
      throw new RangeError('ReSellCodes API key is required');
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError('ReSellCodes timeout must be a positive safe integer');
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = timeoutMs;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** One request, no retry. Purchases use this directly. */
  async call(options: { method: 'GET' | 'POST'; path: string; body?: unknown }): Promise<ResellCodesResponse> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${options.path}`, {
        method: options.method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ResellCodesSupplierError('NETWORK_ERROR', 'ReSellCodes could not be reached', { cause: error });
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
   * A read that rides out throttling (waiting the stated `Retry-After`), a
   * gateway hiccup, or a dropped connection. A timeout is not retried: it has
   * already spent the whole per-request budget once.
   */
  async read(path: string): Promise<ResellCodesResponse> {
    let rateLimited = 0;
    let transient = 0;
    for (;;) {
      let response: ResellCodesResponse;
      try {
        response = await this.call({ method: 'GET', path });
      } catch (error) {
        const delay = CATALOG_RETRY_DELAYS_MS[transient];
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
      const delay = CATALOG_RETRY_DELAYS_MS[transient];
      if (delay !== undefined && RETRYABLE_STATUSES.has(response.status)) {
        transient += 1;
        await this.sleep(delay);
        continue;
      }
      return response;
    }
  }

  expectOk(response: ResellCodesResponse, code: string): unknown {
    if (response.status !== 200 && response.status !== 201) {
      throw new ResellCodesSupplierError(
        normaliseErrorCode(response.payload, code),
        `ReSellCodes refused the request with HTTP ${String(response.status)}`,
        { httpStatus: response.status },
      );
    }
    return response.payload;
  }

  async balance(clock: () => Date): Promise<SupplierBalance> {
    const payload = this.expectOk(await this.read('/me'), 'BALANCE_UNAVAILABLE');
    if (!isObject(payload)) {
      throw new ResellCodesSupplierError('INVALID_RESPONSE', 'ReSellCodes account payload is unusable');
    }
    return { ...usd(payload['balance_usd'], 'balance_usd'), observedAt: clock() };
  }

  /** `GET /orders/{number}`, tolerant of the order being wrapped in `order`. */
  async order(number: string): Promise<{ status: number; order: JsonObject | null; payload: unknown }> {
    const response = await this.read(`/orders/${encodeURIComponent(number)}`);
    const payload = response.payload;
    const order = isObject(payload) ? (isObject(payload['order']) ? payload['order'] : payload) : null;
    return { status: response.status, order, payload };
  }
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
  if (!(error instanceof ResellCodesSupplierError) || error.code !== 'NETWORK_ERROR') {
    return false;
  }
  const cause: unknown = error.cause;
  return !(isObject(cause) && cause['name'] === 'TimeoutError');
}

/** Lists wrap their rows in `data`; a body that is not one is a broken answer, not an empty catalogue. */
function listRows(payload: unknown, what: string): readonly JsonObject[] {
  if (!isObject(payload) || !Array.isArray(payload['data'])) {
    throw new ResellCodesSupplierError('INVALID_RESPONSE', `ReSellCodes ${what} was not a list`);
  }
  return payload['data'].filter(isObject);
}

/**
 * Purchases have no venue-side idempotency (no `Idempotency-Key` is documented),
 * so a second POST with the same key would be a second charge. Two defences live
 * here and one belongs to the caller:
 *
 *  - calls racing on one key within this process share a single request;
 *  - once a request has gone out, its outcome is remembered and replayed for the
 *    same key instead of being sent again (this covers `UNKNOWN` too);
 *  - across a restart nothing remembers, so the caller must never resend a key
 *    whose answer was `UNKNOWN` — it goes to a human, who checks the venue's
 *    `GET /orders` before anything is bought again.
 *
 * These adapters therefore never set `idempotentPurchases`.
 */
class PurchaseMemory {
  private readonly inFlight = new Map<string, Promise<SupplierPurchaseResult>>();
  private readonly settled = new Map<string, SupplierPurchaseResult>();

  async run(key: string, attempt: () => Promise<{ result: SupplierPurchaseResult; sent: boolean }>): Promise<SupplierPurchaseResult> {
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

/** What a POST answer means, shared by both products. `UNKNOWN` unless the venue plainly refused. */
function classifyPostFailure(response: ResellCodesResponse): SupplierPurchaseResult {
  if (response.status === 429) {
    /* The limiter refuses the call before order logic runs: nothing charged. */
    return { status: 'FAILED', failureCode: 'RATE_LIMITED' };
  }
  if (response.status >= 400 && response.status < 500) {
    return { status: 'FAILED', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_REJECTED') };
  }
  /* 5xx or an unreadable body: the order may well have been placed and charged. */
  return { status: 'UNKNOWN', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_UNAVAILABLE') };
}

function orderNumber(order: JsonObject): string | null {
  const number = trimmed(order['number']);
  return number !== null && ORDER_NUMBER_PATTERN.test(number) ? number : null;
}

function chargedCost(order: JsonObject): SupplierPrice['cost'] | undefined {
  try {
    return usd(order['charged_usd'], 'charged_usd');
  } catch {
    return undefined;
  }
}

/** The status block shared by every order type; `settle` supplies the asset for a completed one. */
function settleOrder(
  order: unknown,
  settle: (order: JsonObject) => SupplierDeliveryAsset | null,
): SupplierPurchaseResult {
  if (!isObject(order)) {
    return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
  }
  const providerReference = orderNumber(order);
  if (providerReference === null) {
    return { status: 'UNKNOWN', failureCode: 'ORDER_NUMBER_MISSING' };
  }
  const status = mapOrderStatus(trimmed(order['status'])?.toLowerCase() ?? null);
  const cost = chargedCost(order);
  const base = { providerReference, ...(cost === undefined ? {} : { cost }) };

  if (status === 'FAILED') {
    return { ...base, status, failureCode: mapFailCode(order['fail_code']) };
  }
  if (status !== 'SUCCEEDED') {
    return { ...base, status };
  }

  const asset = settle(order);
  if (asset === null) {
    /* Charged and completed, but nothing usable to hand over: a human must look. */
    return { ...base, status: 'UNKNOWN', failureCode: 'DELIVERY_MISSING' };
  }
  return { ...base, status: 'SUCCEEDED', asset };
}

/* ============================================================================
 * Gift cards
 * ==========================================================================*/

/**
 * One entry of `codes[]`. The docs do not show its shape, so a bare string and
 * an object with `code`/`pin`/`serial` are both read. Never logged or echoed.
 */
function toCodeAsset(entry: unknown): SupplierDeliveryAsset | null {
  const plain = trimmed(entry);
  if (plain !== null) {
    return { assetType: 'CODE', code: plain };
  }
  if (!isObject(entry)) {
    return null;
  }
  const code = firstString(entry, ['code', 'key', 'value']);
  if (code === null) {
    return null;
  }
  const serialNumber = firstString(entry, ['serial', 'serial_number']);
  const pin = firstString(entry, ['pin']);
  return pin === null
    ? { assetType: 'CODE', code, ...(serialNumber === null ? {} : { serialNumber }) }
    : { assetType: 'CODE_PIN', code, pin, ...(serialNumber === null ? {} : { serialNumber }) };
}

/**
 * ReSellCodes (resell.codes) gift-card adapter, `Supplier.code = resellcodes`.
 *
 * Built from the published API reference at https://resell.codes/docs (fetched
 * 2026-10-27) — no live account was called while writing it, so every response
 * shape is **inferred from documentation**. In particular `codes[]` entries and
 * the wrapping of the order object are unspecified; both are read tolerantly.
 * Do not set `RESELLCODES_ENABLED=true` before a read-only check against the
 * real account (`getCatalog`, `getBalance`) and a supervised low-value order.
 *
 * Provider SKU is `<category_id>:<card_id>`. Only quantity 1 is bought: the
 * result carries one asset, and one order per unit keeps a failure attributable.
 * The venue's `region` lives on `/gift-cards/brands`; this adapter does not
 * fetch it, so every item reports `GLOBAL` — a known gap, not a considered default.
 */
export class ResellCodesGiftCardSupplierProvider implements SupplierProvider {
  readonly key = 'resellcodes';

  private readonly client: ResellCodesClient;
  private readonly clock: () => Date;
  private readonly purchases = new PurchaseMemory();

  constructor(options: ResellCodesSupplierProviderOptions) {
    this.client = new ResellCodesClient(options);
    this.clock = options.clock ?? (() => new Date());
  }

  getBalance(): Promise<SupplierBalance> {
    return this.client.balance(this.clock);
  }

  /** One request per category, so a full walk is slow on a new account's 30/min limit. */
  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    const categories = listRows(
      this.client.expectOk(await this.client.read('/gift-cards/categories'), 'CATALOG_UNAVAILABLE'),
      'gift-card categories',
    );
    const items: SupplierCatalogItem[] = [];
    for (const category of categories) {
      const categoryId = trimmed(category['category_id']);
      if (categoryId === null) {
        continue;
      }
      const brand = trimmed(category['name']) ?? categoryId;
      const response = await this.client.read(`/gift-cards/categories/${encodeURIComponent(categoryId)}/cards`);
      if (response.status === 404) {
        continue;
      }
      for (const offer of this.offersOf(this.client.expectOk(response, 'CATALOG_UNAVAILABLE'))) {
        const cardId = trimmed(offer['card_id']);
        if (cardId === null) {
          continue;
        }
        try {
          items.push({
            providerSku: formatResellCodesProviderSku(categoryId, cardId),
            name: trimmed(offer['name']) ?? cardId,
            brand,
            region: 'GLOBAL',
            faceValue: usd(offer['price_usd'], 'price_usd'),
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
    const offer = await this.fetchOffer(parseResellCodesProviderSku(providerSku));
    return { providerSku, cost: usd(offer['price_usd'], 'price_usd'), observedAt: this.clock() };
  }

  /**
   * A transport failure is UNKNOWN, never UNAVAILABLE: an unreachable venue is
   * not a sold-out one, and reporting it as sold out would silently divert
   * orders to a costlier supplier.
   */
  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    const observedAt = this.clock();
    let ref: ResellCodesOfferRef;
    try {
      ref = parseResellCodesProviderSku(providerSku);
    } catch {
      return { providerSku, availability: 'UNAVAILABLE', observedAt };
    }

    let availability: SupplierAvailability;
    try {
      const stock = (await this.fetchOffer(ref))['stock'];
      availability = typeof stock === 'number' && stock <= 0 ? 'UNAVAILABLE' : 'AVAILABLE';
    } catch (error) {
      availability =
        error instanceof ResellCodesSupplierError && error.code === 'OFFER_NOT_FOUND' ? 'UNAVAILABLE' : 'UNKNOWN';
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
    let ref: ResellCodesOfferRef;
    try {
      ref = parseResellCodesProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    return this.purchases.run(identifier, async () => {
      let response: ResellCodesResponse;
      try {
        response = await this.client.call({
          method: 'POST',
          path: '/gift-cards/order',
          body: { category_id: ref.categoryId, card_id: ref.itemId, quantity: 1 },
        });
      } catch {
        /* The request may have reached the venue before the connection died. */
        return { result: { status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' }, sent: true };
      }
      if (response.status === 200 || response.status === 201) {
        return { result: this.settle(response.payload), sent: true };
      }
      return { result: classifyPostFailure(response), sent: true };
    });
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    const reference = providerReference.trim();
    if (!ORDER_NUMBER_PATTERN.test(reference)) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
    }
    const { status, order, payload } = await this.client.order(reference);
    if (status === 404) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'ORDER_NOT_FOUND' };
    }
    if (status !== 200) {
      return { status: 'UNKNOWN', providerReference, failureCode: normaliseErrorCode(payload, 'STATUS_UNAVAILABLE') };
    }
    return this.settle(order);
  }

  private settle(payload: unknown): SupplierPurchaseResult {
    const source = isObject(payload) && isObject(payload['order']) ? payload['order'] : payload;
    return settleOrder(source, (order) => {
      const codes = order['codes'];
      return Array.isArray(codes) && codes.length === 1 ? toCodeAsset(codes[0]) : null;
    });
  }

  private offersOf(payload: unknown): readonly JsonObject[] {
    return isObject(payload) && Array.isArray(payload['offers']) ? payload['offers'].filter(isObject) : [];
  }

  private async fetchOffer(ref: ResellCodesOfferRef): Promise<JsonObject> {
    const response = await this.client.read(`/gift-cards/categories/${encodeURIComponent(ref.categoryId)}/cards`);
    const offers = response.status === 404 ? [] : this.offersOf(this.client.expectOk(response, 'CATALOG_UNAVAILABLE'));
    const offer = offers.find((entry) => trimmed(entry['card_id']) === ref.itemId);
    if (offer === undefined) {
      throw new ResellCodesSupplierError('OFFER_NOT_FOUND', 'ReSellCodes gift card does not exist');
    }
    return offer;
  }
}

/* ============================================================================
 * Game top-ups
 * ==========================================================================*/

/** Offer lists are one request per game; a few at a time stays inside the 30/min budget's patience. */
const OFFER_FETCH_CONCURRENCY = 2;

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

/**
 * ReSellCodes (resell.codes) game top-up adapter, `Supplier.code = resellcodes-topup`.
 *
 * Same sources and same caveat as the gift-card adapter: built from the
 * published docs, nothing verified against a live response. Provider SKU is
 * `<category_id>:<offer_id>`; the order body's `fields` keys must be the ones the
 * category declares, which the catalogue import stores and the quote path sends
 * back verbatim as `accountFields`.
 *
 * A top-up credits the player's own account, so the asset is `DIRECT_TOPUP` and
 * carries no secret. A game that asks for a password is flagged
 * `requiresCredentials` and is never sold. Only one top-up per order exists on
 * this venue, so quantity must be 1.
 */
export class ResellCodesTopUpSupplierProvider implements SupplierProvider {
  readonly key = 'resellcodes-topup';

  private readonly client: ResellCodesClient;
  private readonly clock: () => Date;
  private readonly purchases = new PurchaseMemory();

  constructor(options: ResellCodesSupplierProviderOptions) {
    this.client = new ResellCodesClient(options);
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
                providerSku: formatResellCodesProviderSku(game.categoryId, offer.offerId),
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

  /** The import's read: a game that still fails after the retries is reported, not fatal to the rest. */
  async readTopUpCatalog(): Promise<SupplierTopUpCatalogRead> {
    return this.collect(true);
  }

  private async collect(tolerant: boolean): Promise<SupplierTopUpCatalogRead> {
    const categories = listRows(
      this.client.expectOk(await this.client.read('/top-ups/categories'), 'CATALOG_UNAVAILABLE'),
      'top-up categories',
    ).flatMap((row) => {
      const categoryId = trimmed(row['category_id']);
      return categoryId === null ? [] : [{ categoryId, name: trimmed(row['name']) ?? categoryId, raw: row }];
    });
    const regions = await this.readRegions();

    type Outcome =
      | { readonly ok: true; readonly game: SupplierTopUpGame | null }
      | { readonly ok: false; readonly error: ResellCodesSupplierError };
    const outcomes = await mapWithConcurrency(categories, OFFER_FETCH_CONCURRENCY, async (category): Promise<Outcome> => {
      try {
        const listing = await this.fetchOffers(category.categoryId);
        return { ok: true, game: listing === null ? null : this.toGame(category, listing, regions) };
      } catch (error) {
        if (!tolerant || !(error instanceof ResellCodesSupplierError)) {
          throw error;
        }
        return { ok: false, error };
      }
    });

    const games: SupplierTopUpGame[] = [];
    const unreadable: SupplierTopUpUnreadableGame[] = [];
    let firstError: ResellCodesSupplierError | null = null;
    outcomes.forEach((outcome, index) => {
      const category = categories[index];
      if (category === undefined) {
        return;
      }
      if (!outcome.ok) {
        firstError ??= outcome.error;
        unreadable.push({ categoryId: category.categoryId, name: category.name, failureCode: outcome.error.code });
      } else if (outcome.game !== null) {
        games.push(outcome.game);
      }
    });
    if (firstError !== null && unreadable.length === categories.length) {
      throw firstError;
    }
    return { games, unreadable };
  }

  /** `category_id` -> region from `/top-ups/brands`. A failure here costs the region label only. */
  private async readRegions(): Promise<ReadonlyMap<string, string>> {
    const regions = new Map<string, string>();
    try {
      const response = await this.client.read('/top-ups/brands');
      for (const brand of listRows(this.client.expectOk(response, 'CATALOG_UNAVAILABLE'), 'top-up brands')) {
        const subcategories = brand['subcategories'];
        for (const sub of Array.isArray(subcategories) ? subcategories.filter(isObject) : []) {
          const categoryId = trimmed(sub['category_id']);
          const region = trimmed(sub['region']);
          if (categoryId !== null && region !== null) {
            regions.set(categoryId, region);
          }
        }
      }
    } catch {
      /* Every game then reports GLOBAL, which is what it would have done without the endpoint. */
    }
    return regions;
  }

  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const offer = await this.fetchOffer(parseResellCodesProviderSku(providerSku));
    return { providerSku, cost: usd(offer['price_usd'], 'price_usd'), observedAt: this.clock() };
  }

  /** The documented offer carries no `stock`; being listed is what "available" means. Transport failure is UNKNOWN. */
  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    const observedAt = this.clock();
    let ref: ResellCodesOfferRef;
    try {
      ref = parseResellCodesProviderSku(providerSku);
    } catch {
      return { providerSku, availability: 'UNAVAILABLE', observedAt };
    }

    let availability: SupplierAvailability;
    try {
      await this.fetchOffer(ref);
      availability = 'AVAILABLE';
    } catch (error) {
      availability =
        error instanceof ResellCodesSupplierError && error.code === 'OFFER_NOT_FOUND' ? 'UNAVAILABLE' : 'UNKNOWN';
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
    let ref: ResellCodesOfferRef;
    try {
      ref = parseResellCodesProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    const accountReference = Object.entries(accountFields)
      .map(([field, value]) => `${field}=${value}`)
      .join(', ');

    return this.purchases.run(identifier, async () => {
      let response: ResellCodesResponse;
      try {
        response = await this.client.call({
          method: 'POST',
          path: '/top-ups/order',
          body: { category_id: ref.categoryId, offer_id: ref.itemId, fields: accountFields },
        });
      } catch {
        /* The request may have reached the venue, and a top-up cannot be taken back. */
        return { result: { status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' }, sent: true };
      }
      if (response.status === 200 || response.status === 201) {
        return { result: this.settle(response.payload, accountReference), sent: true };
      }
      return { result: classifyPostFailure(response), sent: true };
    });
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    const reference = providerReference.trim();
    if (!ORDER_NUMBER_PATTERN.test(reference)) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
    }
    const { status, order, payload } = await this.client.order(reference);
    if (status === 404) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'ORDER_NOT_FOUND' };
    }
    if (status !== 200) {
      return { status: 'UNKNOWN', providerReference, failureCode: normaliseErrorCode(payload, 'STATUS_UNAVAILABLE') };
    }
    return this.settle(order, undefined);
  }

  private settle(payload: unknown, fallbackAccountReference: string | undefined): SupplierPurchaseResult {
    const source = isObject(payload) && isObject(payload['order']) ? payload['order'] : payload;
    return settleOrder(source, (): SupplierDeliveryAsset | null =>
      /* The order echoes no account, so a status poll cannot name one; the purchase call can. */
      fallbackAccountReference === undefined
        ? { assetType: 'DIRECT_TOPUP', accountReference: 'credited' }
        : { assetType: 'DIRECT_TOPUP', accountReference: fallbackAccountReference },
    );
  }

  /** `null` for a 404: the venue may still list a category it no longer sells. */
  private async fetchOffers(categoryId: string): Promise<{ offers: readonly JsonObject[]; payload: JsonObject } | null> {
    const response = await this.client.read(`/top-ups/categories/${encodeURIComponent(categoryId)}/offers`);
    if (response.status === 404) {
      return null;
    }
    const payload = this.client.expectOk(response, 'CATALOG_UNAVAILABLE');
    if (!isObject(payload) || !Array.isArray(payload['offers'])) {
      throw new ResellCodesSupplierError('INVALID_RESPONSE', 'ReSellCodes offer list was not a list');
    }
    return { offers: payload['offers'].filter(isObject), payload };
  }

  private async fetchOffer(ref: ResellCodesOfferRef): Promise<JsonObject> {
    const offers = (await this.fetchOffers(ref.categoryId))?.offers ?? [];
    const offer = offers.find((entry) => trimmed(entry['offer_id']) === ref.itemId);
    if (offer === undefined) {
      throw new ResellCodesSupplierError('OFFER_NOT_FOUND', 'ReSellCodes top-up offer does not exist');
    }
    return offer;
  }

  private toGame(
    category: { categoryId: string; name: string; raw: JsonObject },
    listing: { offers: readonly JsonObject[]; payload: JsonObject },
    regions: ReadonlyMap<string, string>,
  ): SupplierTopUpGame {
    const fields = parseFields(listing.payload);
    const offers = listing.offers.flatMap((offer): SupplierTopUpOffer[] => {
      const offerId = trimmed(offer['offer_id']);
      if (offerId === null) {
        return [];
      }
      let cost: SupplierTopUpOffer['cost'] = null;
      try {
        cost = usd(offer['price_usd'], 'price_usd');
      } catch {
        /* Imported without a price; quotes re-read it live and refuse if it is still missing. */
      }
      return [{ offerId, name: trimmed(offer['name']) ?? offerId, cost }];
    });

    return {
      categoryId: category.categoryId,
      name: category.name,
      region: regions.get(category.categoryId) ?? 'GLOBAL',
      note: trimmed(category.raw['note']),
      imageUrl: parseImageUrl(category.raw),
      fields,
      offers,
      requiresCredentials: fields.some((field) => field.credential),
    };
  }
}

/* ============================================================================
 * Telegram Stars and Premium
 * ==========================================================================*/

/** The packages we list. The venue sells any Stars quantity from `min` to `max`; the ladder is ours. */
export const RESELLCODES_TELEGRAM_STARS_QUANTITIES = [50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000] as const;
export const RESELLCODES_TELEGRAM_PREMIUM_MONTHS = [3, 6, 12] as const;

export type ResellCodesTelegramSku =
  | { readonly kind: 'stars'; readonly quantity: number }
  | { readonly kind: 'premium'; readonly months: number };

/**
 * `telegram:stars:<quantity>` / `telegram:premium:<months>` — the same shape the
 * FazerCards Telegram adapter uses, so a catalogue row reads the same whichever
 * venue backs it.
 */
export function parseResellCodesTelegramProviderSku(providerSku: string): ResellCodesTelegramSku {
  const match = /^telegram:(stars|premium):([1-9]\d*)$/u.exec(providerSku.trim());
  const kind = match?.[1];
  const value = Number(match?.[2]);
  if (kind === 'stars' && (RESELLCODES_TELEGRAM_STARS_QUANTITIES as readonly number[]).includes(value)) {
    return { kind, quantity: value };
  }
  if (kind === 'premium' && (RESELLCODES_TELEGRAM_PREMIUM_MONTHS as readonly number[]).includes(value)) {
    return { kind, months: value };
  }
  throw new ResellCodesSupplierError('INVALID_PROVIDER_SKU', 'Invalid ReSellCodes Telegram provider SKU');
}

const RATE_SCALE = 7;
const RATE_UNIT = 10n ** BigInt(RATE_SCALE);
const RATE_TO_MONEY = RATE_UNIT / MONEY_UNIT;

/**
 * Cost of `quantity` Stars. `price_per_star` carries seven decimals, so the
 * product is formed in 10^-7 units and only then rounded UP (ceiling) to the
 * four places money is held in: rounding each star first would drift, and
 * rounding down would under-state what the venue charges. No JS number is used.
 */
function starsCost(rate: unknown, quantity: number): string {
  const text = typeof rate === 'string' ? rate.trim() : '';
  if (!/^\d{1,12}(?:\.\d{1,7})?$/u.test(text)) {
    throw new ResellCodesSupplierError('INVALID_RESPONSE', 'price_per_star is not a usable amount');
  }
  const [whole = '0', fraction = ''] = text.split('.');
  const scaledRate = BigInt(whole) * RATE_UNIT + BigInt(fraction.padEnd(RATE_SCALE, '0'));
  return formatAmount((scaledRate * BigInt(quantity) + RATE_TO_MONEY - 1n) / RATE_TO_MONEY);
}

/** Telegram usernames are 5-32 of [A-Za-z0-9_]; older accounts can be shorter, so the floor is 4. */
const TELEGRAM_USERNAME_PATTERN = /^[A-Za-z0-9_]{4,32}$/u;

/**
 * ReSellCodes (resell.codes) Telegram adapter, `Supplier.code = resellcodes-telegram`.
 *
 * Stars and Premium have their own endpoints on this venue (`/telegram/stars`,
 * `/telegram/premium`), apart from `/top-ups`. Same sources and caveats as the
 * other ReSellCodes adapters: built from the published OpenAPI, nothing
 * verified against a live response, no sandbox and no idempotency key.
 *
 * Prices are read live. Delivery credits the customer's own account, so the
 * asset is `DIRECT_TOPUP` and carries no secret. The username is sent without a
 * leading `@`, the form the venue's own example uses.
 */
export class ResellCodesTelegramSupplierProvider implements SupplierProvider {
  readonly key = 'resellcodes-telegram';

  private readonly client: ResellCodesClient;
  private readonly clock: () => Date;
  private readonly purchases = new PurchaseMemory();

  constructor(options: ResellCodesSupplierProviderOptions) {
    this.client = new ResellCodesClient(options);
    this.clock = options.clock ?? (() => new Date());
  }

  getBalance(): Promise<SupplierBalance> {
    return this.client.balance(this.clock);
  }

  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    const [stars, premium] = await Promise.all([this.fetchStars(), this.fetchPremium()]);
    return [
      ...RESELLCODES_TELEGRAM_STARS_QUANTITIES.filter((quantity) => quantity >= stars.min && quantity <= stars.max).map(
        (quantity): SupplierCatalogItem => ({
          providerSku: `telegram:stars:${String(quantity)}`,
          name: `Telegram ${String(quantity)} Stars`,
          region: 'GLOBAL',
          faceValue: { amount: starsCost(stars.rate, quantity), currency: 'USD' },
          assetType: 'DIRECT_TOPUP',
          requiredAccountFields: ['telegram_username'],
        }),
      ),
      ...RESELLCODES_TELEGRAM_PREMIUM_MONTHS.flatMap((months): SupplierCatalogItem[] => {
        const price = premium.get(months);
        return price === undefined
          ? []
          : [
              {
                providerSku: `telegram:premium:${String(months)}`,
                name: `Telegram Premium ${String(months)} Months`,
                region: 'GLOBAL',
                faceValue: { amount: formatAmount(price), currency: 'USD' },
                assetType: 'DIRECT_TOPUP',
                requiredAccountFields: ['telegram_username'],
              },
            ];
      }),
    ];
  }

  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const ref = parseResellCodesTelegramProviderSku(providerSku);
    let amount: string;
    if (ref.kind === 'stars') {
      const stars = await this.fetchStars();
      if (ref.quantity < stars.min || ref.quantity > stars.max) {
        throw new ResellCodesSupplierError('OFFER_NOT_FOUND', 'ReSellCodes Telegram Stars quantity is unavailable');
      }
      amount = starsCost(stars.rate, ref.quantity);
    } else {
      const price = (await this.fetchPremium()).get(ref.months);
      if (price === undefined) {
        throw new ResellCodesSupplierError('OFFER_NOT_FOUND', 'ReSellCodes Telegram Premium plan is unavailable');
      }
      amount = formatAmount(price);
    }
    return { providerSku, cost: { amount, currency: 'USD' }, observedAt: this.clock() };
  }

  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    const observedAt = this.clock();
    let ref: ResellCodesTelegramSku;
    try {
      ref = parseResellCodesTelegramProviderSku(providerSku);
    } catch {
      return { providerSku, availability: 'UNAVAILABLE', observedAt };
    }
    let availability: SupplierAvailability;
    try {
      if (ref.kind === 'stars') {
        const stars = await this.fetchStars();
        availability = ref.quantity >= stars.min && ref.quantity <= stars.max ? 'AVAILABLE' : 'UNAVAILABLE';
      } else {
        availability = (await this.fetchPremium()).has(ref.months) ? 'AVAILABLE' : 'UNAVAILABLE';
      }
    } catch {
      availability = 'UNKNOWN';
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
    const supplied = trimmed(request.accountFields?.['telegram_username']);
    if (supplied === null) {
      return { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' };
    }
    const username = supplied.replace(/^@/u, '');
    /* Refused before anything is sent, so nothing is charged for a name that cannot exist. */
    if (!TELEGRAM_USERNAME_PATTERN.test(username)) {
      return { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_INVALID' };
    }
    let ref: ResellCodesTelegramSku;
    try {
      ref = parseResellCodesTelegramProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    return this.purchases.run(identifier, async () => {
      let response: ResellCodesResponse;
      try {
        response = await this.client.call({
          method: 'POST',
          path: ref.kind === 'stars' ? '/telegram/stars/buy' : '/telegram/premium/buy',
          body:
            ref.kind === 'stars'
              ? { telegram_username: username, quantity: ref.quantity }
              : { telegram_username: username, months: ref.months },
        });
      } catch {
        /* The request may have reached the venue, and a delivered top-up cannot be taken back. */
        return { result: { status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' }, sent: true };
      }
      if (response.status === 200 || response.status === 201) {
        return { result: this.settle(response.payload, username), sent: true };
      }
      return { result: classifyPostFailure(response), sent: true };
    });
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    const reference = providerReference.trim();
    if (!ORDER_NUMBER_PATTERN.test(reference)) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
    }
    const { status, order, payload } = await this.client.order(reference);
    if (status === 404) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'ORDER_NOT_FOUND' };
    }
    if (status !== 200) {
      return { status: 'UNKNOWN', providerReference, failureCode: normaliseErrorCode(payload, 'STATUS_UNAVAILABLE') };
    }
    return this.settle(order, undefined);
  }

  /** The order echoes the username on Telegram orders; the request's own stands in when it does not. */
  private settle(payload: unknown, requested: string | undefined): SupplierPurchaseResult {
    const source = isObject(payload) && isObject(payload['order']) ? payload['order'] : payload;
    return settleOrder(source, (order): SupplierDeliveryAsset | null => {
      const accountReference = trimmed(order['telegram_username']) ?? requested ?? 'credited';
      return { assetType: 'DIRECT_TOPUP', accountReference };
    });
  }

  private async fetchStars(): Promise<{ rate: string; min: number; max: number }> {
    const payload = this.client.expectOk(await this.client.read('/telegram/stars'), 'CATALOG_UNAVAILABLE');
    if (!isObject(payload)) {
      throw new ResellCodesSupplierError('INVALID_RESPONSE', 'ReSellCodes Stars pricing payload is unusable');
    }
    const rate = payload['price_per_star'];
    const min = payload['min'];
    const max = payload['max'];
    if (typeof rate !== 'string' || typeof min !== 'number' || typeof max !== 'number' ||
      !Number.isSafeInteger(min) || !Number.isSafeInteger(max) || min < 1 || max < min) {
      throw new ResellCodesSupplierError('INVALID_RESPONSE', 'ReSellCodes Stars pricing payload is unusable');
    }
    starsCost(rate, 1);
    return { rate, min, max };
  }

  private async fetchPremium(): Promise<ReadonlyMap<number, bigint>> {
    const payload = this.client.expectOk(await this.client.read('/telegram/premium'), 'CATALOG_UNAVAILABLE');
    if (!isObject(payload) || !Array.isArray(payload['plans'])) {
      throw new ResellCodesSupplierError('INVALID_RESPONSE', 'ReSellCodes Premium pricing payload is unusable');
    }
    const plans = new Map<number, bigint>();
    for (const plan of payload['plans']) {
      if (
        !isObject(plan) ||
        typeof plan['months'] !== 'number' ||
        !(RESELLCODES_TELEGRAM_PREMIUM_MONTHS as readonly number[]).includes(plan['months'])
      ) {
        continue;
      }
      plans.set(plan['months'], parseAmount(plan['price_usd'], 'price_usd'));
    }
    return plans;
  }
}
