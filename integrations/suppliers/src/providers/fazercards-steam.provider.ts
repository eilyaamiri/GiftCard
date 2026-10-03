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
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const MAX_STEAM_LOGIN_LENGTH = 64;
const ORDER_ID_PATTERN = /^ord-[0-9]+$/u;
const STEAM_LOGIN_PATTERN = /^[^\s\p{Cc}]+$/u;

/**
 * The USD wallet top-ups we offer. The venue publishes no list of amounts — it
 * accepts any USD value with at most two decimals — so the ladder is ours, and
 * it is a product decision, not something this adapter discovers.
 */
export const STEAM_USD_AMOUNTS = ['5', '10', '15', '20', '25', '50', '100'] as const;

/** Outer bounds a SKU may carry; anything beyond is refused rather than sent. */
const MAX_STEAM_USD = 1_000n * 100n;

export interface FazerCardsSteamSku {
  readonly currency: 'USD';
  /** The wallet credit in whole US cents. */
  readonly cents: bigint;
}

/** Adapter-owned failure; neither the API key nor venue prose belongs in its message. */
export class FazerCardsSteamSupplierError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'FazerCardsSteamSupplierError';
    this.code = code;
  }
}

export interface FazerCardsSteamSupplierProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly clock?: () => Date;
}

type JsonObject = Record<string, unknown>;

interface FazerCardsResponse {
  readonly status: number;
  readonly payload: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function centsOf(amount: string): bigint {
  const [whole = '0', fraction = ''] = amount.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

/** `500n` -> `"5"`, `1050n` -> `"10.5"`: the shortest decimal the venue's USD rule accepts. */
function usdString(cents: bigint): string {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, '0').replace(/0+$/u, '');
  return fraction === '' ? whole.toString() : `${whole}.${fraction}`;
}

function formatMoney(cents: bigint): string {
  const scaled = cents * (MONEY_UNIT / 100n);
  return `${scaled / MONEY_UNIT}.${(scaled % MONEY_UNIT).toString().padStart(MONEY_SCALE, '0')}`;
}

export function parseFazerCardsSteamProviderSku(providerSku: string): FazerCardsSteamSku {
  const match = /^steam:usd:(\d{1,4}(?:\.\d{1,2})?)$/u.exec(providerSku);
  const amount = match?.[1];
  if (amount !== undefined) {
    const cents = centsOf(amount);
    if (cents > 0n && cents <= MAX_STEAM_USD) {
      return { currency: 'USD', cents };
    }
  }
  throw new FazerCardsSteamSupplierError('INVALID_PROVIDER_SKU', 'Invalid FazerCards Steam provider SKU');
}

export function formatFazerCardsSteamProviderSku(usdAmount: string): string {
  const sku = `steam:usd:${usdAmount}`;
  parseFazerCardsSteamProviderSku(sku);
  return sku;
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
    case 'PENDING':
    case 'PROCESSING': return 'PENDING';
    case 'FAILED':
    case 'REFUNDED':
    case 'CANCELLED':
    case 'CANCELED': return 'FAILED';
    default: return 'UNKNOWN';
  }
}

/**
 * FazerCards Steam wallet top-up adapter. The endpoints, the request shapes and
 * the `Idempotency-Key` header are verified against the public OpenAPI; the
 * created order's internal shape is not documented (`additionalProperties`), so
 * its status is read defensively and a 201 without a recognised status is
 * PENDING when the order is pollable and UNKNOWN otherwise — never proof that
 * the wallet was credited.
 *
 * Unlike Telegram, this endpoint honours a real `Idempotency-Key`: replaying a
 * key returns the original order instead of charging again, so no process-local
 * memory is needed and a restart cannot cause a double charge.
 *
 * Cost: the customer is quoted the USD face value. The venue bills "according
 * to your plan", which the API does not expose; the margin must be set with
 * that plan multiplier in mind (a pricing human gate).
 *
 * The venue's own `check-login` runs inside `purchase()`, before any charge:
 * a login that cannot be refilled is refused up front. Its `unverified` answer
 * is not a refusal — the venue says an unknown login is refunded automatically.
 */
export class FazerCardsSteamSupplierProvider implements SupplierProvider {
  readonly key = 'fazercards-steam';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly clock: () => Date;

  constructor(options: FazerCardsSteamSupplierProviderOptions) {
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
    const currency = isObject(payload) ? trimmed(payload['currency']) : null;
    const balance = isObject(payload) ? payload['balance'] : undefined;
    if (currency === null || typeof balance !== 'string' || !/^\d{1,12}(?:\.\d{1,4})?$/u.test(balance)) {
      throw new FazerCardsSteamSupplierError('INVALID_RESPONSE', 'FazerCards balance payload is unusable');
    }
    const [whole = '0', fraction = ''] = balance.split('.');
    const scaled = BigInt(whole) * MONEY_UNIT + BigInt(fraction.padEnd(MONEY_SCALE, '0'));
    return {
      amount: `${scaled / MONEY_UNIT}.${(scaled % MONEY_UNIT).toString().padStart(MONEY_SCALE, '0')}`,
      currency,
      observedAt: this.clock(),
    };
  }

  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    await this.assertRatesLive();
    return STEAM_USD_AMOUNTS.map((amount) => ({
      providerSku: formatFazerCardsSteamProviderSku(amount),
      name: `Steam Wallet $${amount}`,
      region: 'GLOBAL',
      faceValue: { amount: formatMoney(centsOf(amount)), currency: 'USD' },
      assetType: 'DIRECT_TOPUP' as const,
      requiredAccountFields: ['steam_login'],
    }));
  }

  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const ref = parseFazerCardsSteamProviderSku(providerSku);
    await this.assertRatesLive();
    return {
      providerSku,
      cost: { amount: formatMoney(ref.cents), currency: 'USD' },
      observedAt: this.clock(),
    };
  }

  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    let availability: SupplierAvailability;
    try {
      parseFazerCardsSteamProviderSku(providerSku);
    } catch {
      return { providerSku, availability: 'UNAVAILABLE', observedAt: this.clock() };
    }
    try {
      await this.assertRatesLive();
      availability = 'AVAILABLE';
    } catch {
      availability = 'UNKNOWN';
    }
    return { providerSku, availability, observedAt: this.clock() };
  }

  async purchase(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResult> {
    if (request.quantity !== 1) return { status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' };
    const idempotencyKey = request.idempotencyKey.trim();
    if (idempotencyKey === '' || idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return { status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' };
    }
    const login = trimmed(request.accountFields?.['steam_login']);
    if (login === null) return { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' };
    if (login.length > MAX_STEAM_LOGIN_LENGTH || !STEAM_LOGIN_PATTERN.test(login)) {
      return { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_INVALID' };
    }
    let ref: FazerCardsSteamSku;
    try {
      ref = parseFazerCardsSteamProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    /*
     * Nothing has been charged yet, so every failure of this call is a clean
     * FAILED — unlike the order call below, where an ambiguous answer may mean
     * the wallet was already debited.
     */
    const refusal = await this.checkLogin(login);
    if (refusal !== null) return refusal;

    let response: FazerCardsResponse;
    try {
      response = await this.call({
        method: 'POST',
        path: '/steam-topup/order',
        body: { steamLogin: login, currency: ref.currency, amount: usdString(ref.cents) },
        idempotencyKey,
      });
    } catch {
      return { status: 'UNKNOWN', failureCode: 'NETWORK_ERROR' };
    }
    if (response.status === 429) return { status: 'FAILED', failureCode: 'RATE_LIMITED' };
    if (!isObject(response.payload)) return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
    if (response.status >= 400 && response.status < 500) {
      return { status: 'FAILED', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_REJECTED') };
    }
    if (response.status !== 201 && response.status !== 200) {
      return { status: 'UNKNOWN', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_UNAVAILABLE') };
    }
    const order = response.payload['order'];
    if (response.payload['ok'] !== true || !isObject(order)) {
      return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
    }
    const id = trimmed(order['id']);
    const providerReference = id !== null && ORDER_ID_PATTERN.test(id) ? id : undefined;
    const rawStatus = trimmed(order['status']);
    // HTTP 201 confirms creation, not delivery. Without an explicit status,
    // poll the venue order rather than marking the customer fulfilled.
    const status = rawStatus === null
      ? (providerReference === undefined ? 'UNKNOWN' : 'PENDING')
      : mapOrderStatus(rawStatus);
    return this.toResult(status, order, login, providerReference);
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    if (!ORDER_ID_PATTERN.test(providerReference)) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
    }
    let response: FazerCardsResponse;
    try {
      response = await this.call({ method: 'GET', path: `/orders/${providerReference}` });
    } catch {
      return { status: 'UNKNOWN', providerReference, failureCode: 'NETWORK_ERROR' };
    }
    if (response.status !== 200) {
      return {
        status: 'UNKNOWN',
        providerReference,
        failureCode: response.status === 404
          ? 'ORDER_NOT_FOUND'
          : normaliseErrorCode(response.payload, 'STATUS_UNAVAILABLE'),
      };
    }
    const order = isObject(response.payload) && response.payload['ok'] === true ? response.payload['order'] : null;
    if (!isObject(order)) return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_RESPONSE' };
    const status = mapOrderStatus(trimmed(order['status']));
    if (status === 'SUCCEEDED') {
      const accountReference = trimmed(order['steamLogin']) ?? trimmed(order['steam_login']);
      if (accountReference === null) {
        return { status: 'UNKNOWN', providerReference, failureCode: 'ACCOUNT_REFERENCE_MISSING' };
      }
      return { status, providerReference, asset: { assetType: 'DIRECT_TOPUP', accountReference } };
    }
    return this.toResult(status, order, null, providerReference);
  }

  private toResult(
    status: SupplierPurchaseResult['status'],
    order: JsonObject,
    credited: string | null,
    providerReference: string | undefined,
  ): SupplierPurchaseResult {
    const base = providerReference === undefined ? {} : { providerReference };
    if (status === 'SUCCEEDED' && credited !== null) {
      return { ...base, status, asset: { assetType: 'DIRECT_TOPUP', accountReference: credited } };
    }
    if (status === 'FAILED') {
      return { ...base, status, failureCode: normaliseErrorCode(order, 'PROVIDER_DECLINED') };
    }
    return { ...base, status, ...(status === 'UNKNOWN' ? { failureCode: 'ORDER_STATUS_UNKNOWN' } : {}) };
  }

  /** `null` means the login may be topped up (or the venue could not tell and says to proceed). */
  private async checkLogin(login: string): Promise<SupplierPurchaseResult | null> {
    let response: FazerCardsResponse;
    try {
      response = await this.call({ method: 'POST', path: '/steam-topup/check-login', body: { steamLogin: login } });
    } catch {
      return { status: 'FAILED', failureCode: 'LOGIN_CHECK_UNAVAILABLE' };
    }
    if (response.status !== 200 || !isObject(response.payload) || response.payload['ok'] !== true) {
      return { status: 'FAILED', failureCode: normaliseErrorCode(response.payload, 'LOGIN_CHECK_UNAVAILABLE') };
    }
    if (response.payload['can_refill'] !== true) {
      return { status: 'FAILED', failureCode: 'STEAM_LOGIN_CANNOT_REFILL' };
    }
    return null;
  }

  /**
   * The venue's rates are not part of a USD price, so this is a liveness and
   * units check: a payload that does not look like the documented one means
   * the product is not in a state we should be selling from.
   */
  private async assertRatesLive(): Promise<void> {
    const payload = this.expectOk(await this.call({ method: 'GET', path: '/steam-topup/rates' }), 'RATES_UNAVAILABLE');
    const rates = isObject(payload) ? payload['rates'] : undefined;
    const usable = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value) && value > 0;
    if (
      !isObject(payload) || payload['base'] !== 'USD' || !isObject(rates) || rates['USD'] !== 1 ||
      !usable(rates['RUB']) || !usable(rates['UAH']) || !usable(rates['KZT'])
    ) {
      throw new FazerCardsSteamSupplierError('INVALID_RESPONSE', 'FazerCards Steam rates payload is unusable');
    }
  }

  private expectOk(response: FazerCardsResponse, fallback: string): unknown {
    if (response.status !== 200 || !isObject(response.payload) || response.payload['ok'] !== true) {
      throw new FazerCardsSteamSupplierError(
        normaliseErrorCode(response.payload, fallback),
        `FazerCards refused the request with HTTP ${String(response.status)}`,
      );
    }
    return response.payload;
  }

  private async call(options: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<FazerCardsResponse> {
    const headers: Record<string, string> = { 'x-api-key': this.apiKey };
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    if (options.idempotencyKey !== undefined) headers['idempotency-key'] = options.idempotencyKey;
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${options.path}`, {
        method: options.method,
        headers,
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new FazerCardsSteamSupplierError('NETWORK_ERROR', 'FazerCards could not be reached');
    }
    let payload: unknown;
    try { payload = (await response.json()) as unknown; } catch { payload = undefined; }
    return { status: response.status, payload };
  }
}
