import type {
  SupplierAvailability,
  SupplierAvailabilityResult,
  SupplierBalance,
  SupplierCatalogItem,
  SupplierPrice,
  SupplierProvider,
  SupplierPurchaseRequest,
  SupplierPurchaseResult,
} from '../supplier-provider.interface';

const DEFAULT_BASE_URL = 'https://api.fzr.cards/api/v2';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const MONEY_SCALE = 4;
const MONEY_UNIT = 10n ** BigInt(MONEY_SCALE);
const RATE_UNIT = 10n ** 7n;
const PURCHASE_MEMORY_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REMEMBERED_PURCHASES = 1_000;

export const TELEGRAM_STARS_QUANTITIES = [50, 100, 200, 250, 500, 750, 1000, 1500, 2000, 3000, 5000, 10000] as const;
export const TELEGRAM_PREMIUM_MONTHS = [3, 6, 12] as const;

type JsonObject = Record<string, unknown>;
export type FazerCardsTelegramSku =
  | { readonly kind: 'stars'; readonly quantity: number }
  | { readonly kind: 'premium'; readonly months: number };

/** Adapter-owned failure; neither the API key nor venue prose belongs in its message. */
export class FazerCardsTelegramSupplierError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FazerCardsTelegramSupplierError';
    this.code = code;
  }
}

export interface FazerCardsTelegramSupplierProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly clock?: () => Date;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

export function parseFazerCardsTelegramProviderSku(providerSku: string): FazerCardsTelegramSku {
  const match = /^telegram:(stars|premium):([1-9]\d*)$/u.exec(providerSku);
  const kind = match?.[1];
  const value = Number(match?.[2]);
  if (kind === 'stars' && (TELEGRAM_STARS_QUANTITIES as readonly number[]).includes(value)) {
    return { kind, quantity: value };
  }
  if (kind === 'premium' && (TELEGRAM_PREMIUM_MONTHS as readonly number[]).includes(value)) {
    return { kind, months: value };
  }
  throw new FazerCardsTelegramSupplierError('INVALID_PROVIDER_SKU', 'Invalid FazerCards Telegram provider SKU');
}

export function formatFazerCardsTelegramProviderSku(kind: 'stars' | 'premium', value: number): string {
  const sku = `telegram:${kind}:${String(value)}`;
  parseFazerCardsTelegramProviderSku(sku);
  return sku;
}

/** Parses the venue's decimal money strings into fixed-point 10^4 units. */
function parseAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,12}(?:\.\d{1,4})?$/u.test(value)) {
    throw new FazerCardsTelegramSupplierError('INVALID_RESPONSE', `${field} is not a usable amount`);
  }
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * MONEY_UNIT + BigInt(fraction.padEnd(MONEY_SCALE, '0'));
}

function formatAmount(scaled: bigint): string {
  return `${scaled / MONEY_UNIT}.${(scaled % MONEY_UNIT).toString().padStart(MONEY_SCALE, '0')}`;
}

function starsAmount(rate: unknown, quantity: number): string {
  if (typeof rate !== 'string' || !/^\d{1,12}(?:\.\d{1,7})?$/u.test(rate)) {
    throw new FazerCardsTelegramSupplierError('INVALID_RESPONSE', 'price_per_star is not a usable amount');
  }
  const [whole = '0', fraction = ''] = rate.split('.');
  const scaledRate = BigInt(whole) * RATE_UNIT + BigInt(fraction.padEnd(7, '0'));
  /*
   * `price_per_star` carries seven decimals, so the product almost never lands
   * on a whole 10^4 unit. Multiply in 10^7 units FIRST, then round the package
   * total UP (ceiling) to four places: the venue's own published ladder rounds
   * that way, and half-up would disagree with it on six of the twelve packages
   * (50 stars: 0.763125 -> published 0.7632, not 0.7631). Rounding each star to
   * four places *before* multiplying overshoots badly — 10,000 stars would be
   * 152.6300 instead of 152.6250 — so the multiplication always stays integral.
   */
  return formatAmount((scaledRate * BigInt(quantity) + RATE_UNIT / MONEY_UNIT - 1n) / (RATE_UNIT / MONEY_UNIT));
}

function normaliseErrorCode(payload: unknown, fallback: string): string {
  const code = isObject(payload) ? trimmed(payload['code']) : null;
  if (code === null) return fallback;
  const safe = code.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 60);
  return safe === '' ? fallback : `PROVIDER_${safe}`;
}

function mapOrderStatus(status: string | null): SupplierPurchaseResult['status'] {
  switch (status?.toUpperCase()) {
    case 'COMPLETED': return 'SUCCEEDED';
    case 'CREATED':
    case 'PROCESSING': return 'PENDING';
    case 'FAILED':
    case 'REFUNDED': return 'FAILED';
    default: return 'UNKNOWN';
  }
}

interface FazerCardsResponse {
  readonly status: number;
  readonly payload: unknown;
}

interface RememberedPurchase {
  readonly result: SupplierPurchaseResult;
  readonly settledAt: number;
}

/**
 * FazerCards Telegram Stars/Premium adapter. Endpoints and catalog shapes are
 * verified against the public OpenAPI; the purchase order object's internal
 * shape is undocumented. HTTP 201 with no explicit delivery status is PENDING
 * when the order has a pollable reference, or UNKNOWN otherwise; it is never
 * proof that the customer's account was credited.
 *
 * On an explicitly completed response, the credited username comes from the
 * request, not an undocumented order field.
 *
 * Telegram buys have NO venue-side Idempotency-Key. A process-local in-flight
 * map collapses concurrent calls and a 24-hour bounded settled-result map
 * prevents sequential duplicate buys. This cannot protect across processes,
 * restarts, expiry, or an UNKNOWN outcome; reconciliation is required there.
 */
export class FazerCardsTelegramSupplierProvider implements SupplierProvider {
  readonly key = 'fazercards-telegram';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly clock: () => Date;
  private readonly inFlightPurchases = new Map<string, Promise<SupplierPurchaseResult>>();
  private readonly settledPurchases = new Map<string, RememberedPurchase>();

  constructor(options: FazerCardsTelegramSupplierProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey === '') throw new RangeError('FazerCards API key is required');
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError('FazerCards timeout must be a positive safe integer');
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = timeoutMs;
    this.clock = options.clock ?? (() => new Date());
  }

  async getBalance(): Promise<SupplierBalance> {
    const payload = this.expectOk(await this.call({ method: 'GET', path: '/balance' }), 'BALANCE_UNAVAILABLE');
    if (!isObject(payload)) {
      throw new FazerCardsTelegramSupplierError('INVALID_RESPONSE', 'FazerCards balance payload is unusable');
    }
    const currency = trimmed(payload['currency']);
    if (currency === null) {
      throw new FazerCardsTelegramSupplierError('INVALID_RESPONSE', 'FazerCards balance payload is unusable');
    }
    return { amount: formatAmount(parseAmount(payload['balance'], 'balance')), currency, observedAt: this.clock() };
  }

  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    const [stars, premium] = await Promise.all([this.fetchStars(), this.fetchPremium()]);
    return [
      ...TELEGRAM_STARS_QUANTITIES.filter((quantity) => quantity >= stars.min && quantity <= stars.max)
        .map((quantity) => ({
          providerSku: formatFazerCardsTelegramProviderSku('stars', quantity),
          name: `Telegram ${String(quantity)} Stars`, region: 'GLOBAL',
          faceValue: { amount: starsAmount(stars.rate, quantity), currency: 'USD' },
          assetType: 'DIRECT_TOPUP' as const, requiredAccountFields: ['telegram_username'],
        })),
      ...TELEGRAM_PREMIUM_MONTHS.flatMap((months) => {
        const price = premium.get(months);
        return price === undefined ? [] : [{
          providerSku: formatFazerCardsTelegramProviderSku('premium', months),
          name: `Telegram Premium ${String(months)} Months`, region: 'GLOBAL',
          faceValue: { amount: formatAmount(price), currency: 'USD' },
          assetType: 'DIRECT_TOPUP' as const, requiredAccountFields: ['telegram_username'],
        }];
      }),
    ];
  }

  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const ref = parseFazerCardsTelegramProviderSku(providerSku);
    let amount: string;
    if (ref.kind === 'stars') {
      const stars = await this.fetchStars();
      if (ref.quantity < stars.min || ref.quantity > stars.max) {
        throw new FazerCardsTelegramSupplierError('OFFER_NOT_FOUND', 'FazerCards Telegram Stars quantity is unavailable');
      }
      amount = starsAmount(stars.rate, ref.quantity);
    } else {
      const price = (await this.fetchPremium()).get(ref.months);
      if (price === undefined) {
        throw new FazerCardsTelegramSupplierError('OFFER_NOT_FOUND', 'FazerCards Telegram Premium plan is unavailable');
      }
      amount = formatAmount(price);
    }
    return { providerSku, cost: { amount, currency: 'USD' }, observedAt: this.clock() };
  }

  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    let ref: FazerCardsTelegramSku;
    try {
      ref = parseFazerCardsTelegramProviderSku(providerSku);
    } catch {
      return { providerSku, availability: 'UNAVAILABLE', observedAt: this.clock() };
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
    if (request.quantity !== 1) return { status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' };
    const identifier = request.idempotencyKey.trim();
    if (identifier === '') return { status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' };
    const username = trimmed(request.accountFields?.['telegram_username']);
    if (username === null) return { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' };
    let ref: FazerCardsTelegramSku;
    try {
      ref = parseFazerCardsTelegramProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    this.forgetExpiredPurchases();
    const inFlight = this.inFlightPurchases.get(identifier);
    if (inFlight !== undefined) return inFlight;
    const settled = this.settledPurchases.get(identifier);
    if (settled !== undefined) return settled.result;

    const attempt = this.runPurchase(ref, username).then((result) => {
      // UNKNOWN and PENDING are not safe to retry: the venue may already have
      // charged the account. Reconcile by provider reference or escalate instead.
      this.rememberSettled(identifier, result);
      return result;
    }).finally(() => { this.inFlightPurchases.delete(identifier); });
    this.inFlightPurchases.set(identifier, attempt);
    return attempt;
  }

  private async runPurchase(ref: FazerCardsTelegramSku, username: string): Promise<SupplierPurchaseResult> {
    const isStars = ref.kind === 'stars';
    let response: FazerCardsResponse;
    try {
      response = await this.call({
        method: 'POST', path: isStars ? '/telegram/stars/buy' : '/telegram/premium/buy',
        body: isStars ? { telegram_username: username, quantity: ref.quantity }
          : { telegram_username: username, months: ref.months },
      });
    } catch {
      return { status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' };
    }
    if (response.status === 429) return { status: 'FAILED', failureCode: 'RATE_LIMITED' };
    if (response.payload === undefined || !isObject(response.payload)) {
      return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
    }
    if (response.status >= 400 && response.status < 500) {
      return { status: 'FAILED', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_REJECTED') };
    }
    if (response.status !== 201) {
      return { status: 'UNKNOWN', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_UNAVAILABLE') };
    }
    const order = response.payload['order'];
    if (response.payload['ok'] !== true || !isObject(order)) {
      return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
    }
    const id = trimmed(order['id']);
    const providerReference = id !== null && /^ord-[0-9]+$/u.test(id) ? id : undefined;
    const rawStatus = trimmed(order['status']);
    // HTTP 201 confirms creation, not delivery. Without an explicit completed
    // status, poll the venue order rather than marking the customer fulfilled.
    const status = rawStatus === null ? (providerReference === undefined ? 'UNKNOWN' : 'PENDING') : mapOrderStatus(rawStatus);
    const base = providerReference === undefined ? {} : { providerReference };
    if (status === 'SUCCEEDED') {
      return { ...base, status, asset: { assetType: 'DIRECT_TOPUP', accountReference: username } };
    }
    if (status === 'FAILED') {
      return { ...base, status, failureCode: normaliseErrorCode(order, 'PROVIDER_DECLINED') };
    }
    return { ...base, status, ...(status === 'UNKNOWN' ? { failureCode: 'ORDER_STATUS_UNKNOWN' } : {}) };
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    if (!/^ord-[0-9]+$/u.test(providerReference)) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
    }
    let response: FazerCardsResponse;
    try {
      response = await this.call({ method: 'GET', path: `/orders/${providerReference}` });
    } catch {
      return { status: 'UNKNOWN', providerReference, failureCode: 'NETWORK_ERROR' };
    }
    if (response.status !== 200) {
      return { status: 'UNKNOWN', providerReference,
        failureCode: response.status === 404 ? 'ORDER_NOT_FOUND' : normaliseErrorCode(response.payload, 'STATUS_UNAVAILABLE') };
    }
    const order = isObject(response.payload) && response.payload['ok'] === true ? response.payload['order'] : null;
    if (!isObject(order)) return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_RESPONSE' };
    const status = mapOrderStatus(trimmed(order['status']));
    if (status === 'SUCCEEDED') {
      const accountReference = trimmed(order['account_reference']) ?? trimmed(order['telegram_username']);
      if (accountReference === null) {
        return { status: 'UNKNOWN', providerReference, failureCode: 'ACCOUNT_REFERENCE_MISSING' };
      }
      return { status, providerReference, asset: { assetType: 'DIRECT_TOPUP', accountReference } };
    }
    if (status === 'FAILED') {
      return { status, providerReference, failureCode: normaliseErrorCode(order, 'PROVIDER_DECLINED') };
    }
    return { status, providerReference, ...(status === 'UNKNOWN' ? { failureCode: 'ORDER_STATUS_UNKNOWN' } : {}) };
  }

  private rememberSettled(identifier: string, result: SupplierPurchaseResult): void {
    if (this.settledPurchases.size >= MAX_REMEMBERED_PURCHASES) {
      const oldest = this.settledPurchases.keys().next().value;
      if (oldest !== undefined) this.settledPurchases.delete(oldest);
    }
    this.settledPurchases.set(identifier, { result, settledAt: this.clock().getTime() });
  }

  private forgetExpiredPurchases(): void {
    const cutoff = this.clock().getTime() - PURCHASE_MEMORY_TTL_MS;
    for (const [key, entry] of this.settledPurchases) {
      if (entry.settledAt <= cutoff) this.settledPurchases.delete(key);
    }
  }

  private async fetchStars(): Promise<{ rate: string; min: number; max: number }> {
    const payload = this.expectOk(await this.call({ method: 'GET', path: '/telegram/stars' }), 'CATALOG_UNAVAILABLE');
    if (!isObject(payload) || payload['kind'] !== 'telegram_stars' ||
      typeof payload['price_per_star'] !== 'string' ||
      !Number.isSafeInteger(payload['min_amount']) || !Number.isSafeInteger(payload['max_amount']) ||
      (payload['min_amount'] as number) < 1 || (payload['max_amount'] as number) < (payload['min_amount'] as number)) {
      throw new FazerCardsTelegramSupplierError('INVALID_RESPONSE', 'FazerCards Stars rate payload is unusable');
    }
    starsAmount(payload['price_per_star'], 1);
    return { rate: payload['price_per_star'], min: payload['min_amount'] as number, max: payload['max_amount'] as number };
  }

  private async fetchPremium(): Promise<ReadonlyMap<number, bigint>> {
    const payload = this.expectOk(await this.call({ method: 'GET', path: '/telegram/premium' }), 'CATALOG_UNAVAILABLE');
    if (!isObject(payload) || payload['kind'] !== 'telegram_premium' || !Array.isArray(payload['plans'])) {
      throw new FazerCardsTelegramSupplierError('INVALID_RESPONSE', 'FazerCards Premium plans payload is unusable');
    }
    const plans = new Map<number, bigint>();
    for (const plan of payload['plans']) {
      if (!isObject(plan) || typeof plan['months'] !== 'number' ||
        !(TELEGRAM_PREMIUM_MONTHS as readonly number[]).includes(plan['months'])) continue;
      plans.set(plan['months'], parseAmount(plan['price_usd'], 'price_usd'));
    }
    return plans;
  }

  private expectOk(response: FazerCardsResponse, fallback: string): unknown {
    if (response.status !== 200 || !isObject(response.payload) || response.payload['ok'] !== true) {
      throw new FazerCardsTelegramSupplierError(
        normaliseErrorCode(response.payload, fallback),
        `FazerCards refused the request with HTTP ${String(response.status)}`,
      );
    }
    return response.payload;
  }

  private async call(options: { method: 'GET' | 'POST'; path: string; body?: unknown }): Promise<FazerCardsResponse> {
    const headers: Record<string, string> = { 'x-api-key': this.apiKey };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${options.path}`, {
        method: options.method, headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new FazerCardsTelegramSupplierError('NETWORK_ERROR', 'FazerCards could not be reached');
    }
    let payload: unknown;
    try { payload = (await response.json()) as unknown; } catch { payload = undefined; }
    return { status: response.status, payload };
  }
}
