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
} from '../supplier-provider.interface';

/**
 * Reloadly splits authentication from the product API: the token comes from a
 * central auth host and is scoped to one environment by its `audience`.
 * Measured on 2026-09-04, a token minted for the sandbox audience is refused by
 * the production host with `INVALID_TOKEN`, and credentials issued for one
 * environment cannot mint a token for the other at all
 * (`CREDENTIAL_VS_ENVIRONMENT_MISMATCH`). Environment is therefore one setting,
 * not two, and it drives both values together.
 */
const AUTH_URL = 'https://auth.reloadly.com/oauth/token';
const BASE_URLS = {
  production: 'https://giftcards.reloadly.com',
  sandbox: 'https://giftcards-sandbox.reloadly.com',
} as const;

export type ReloadlyEnvironment = keyof typeof BASE_URLS;

/** Reloadly versions its gift-card endpoints through `Accept`, not the path. */
const ACCEPT_VERSION = 'application/com.reloadly.giftcards-v1+json';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;

/** Amounts cross the wire as JSON numbers; see `scaledFromJsonNumber`. */
const MONEY_SCALE = 6;
/**
 * Far inside the range where a double still round-trips six decimals
 * (2^53 / 10^6 is about 9.0e9), so the boundary conversion below is exact for
 * anything Reloadly can legitimately quote for a single gift card.
 */
const MAX_MONEY_UNITS = 1_000_000;

/** `size=200&page=N`; the cap stops a paging bug from looping forever. */
const CATALOG_PAGE_SIZE = 200;
const MAX_CATALOG_PAGES = 25;

/** Reloadly rejects a longer identifier, and truncating one would collide. */
const MAX_CUSTOM_IDENTIFIER_LENGTH = 255;

/**
 * `<productId>:<unitPrice>` — for example `5:25` is a 25 USD Amazon US card.
 *
 * Both halves are required even for a product with a single denomination.
 * Reloadly's `POST /orders` needs an explicit `unitPrice`, and a provider SKU
 * that silently inherited a default would be a price decision made by an
 * absent character in a config string.
 */
const PROVIDER_SKU_PATTERN = /^(\d{1,10}):(\d{1,7}(?:\.\d{1,6})?)$/u;

type JsonObject = Record<string, unknown>;

type Clock = () => Date;

export interface ReloadlyGiftCardSupplierProviderOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly environment?: ReloadlyEnvironment;
  /**
   * Where the gift card is delivered. This is a mailbox we control, never the
   * customer's — see the note on `purchase`.
   */
  readonly recipientEmail: string;
  /** Shown by Reloadly in its own delivery e-mail. */
  readonly senderName?: string;
  /** Test seams. Production wiring leaves both unset. */
  readonly baseUrl?: string;
  readonly authUrl?: string;
  readonly timeoutMs?: number;
  readonly clock?: Clock;
}

/**
 * Adapter-owned failure. `code` is a normalised token from this file's own
 * vocabulary; a raw provider message never travels inside it.
 */
export class ReloadlySupplierError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ReloadlySupplierError';
    this.code = code;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Converts a wire amount to fixed point once, at the boundary.
 *
 * JSON has no decimal type, so Reloadly's amounts arrive as doubles whether we
 * like it or not. They are converted here, immediately, and every calculation
 * afterwards is `bigint` — no money is ever added, multiplied or compared as a
 * float (engineering rule 2).
 */
function scaledFromJsonNumber(value: unknown, field: string): bigint {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > MAX_MONEY_UNITS
  ) {
    throw new ReloadlySupplierError('INVALID_RESPONSE', `${field} is not a usable amount`);
  }
  const [whole = '0', fraction = ''] = value.toFixed(MONEY_SCALE).split('.');
  return BigInt(whole) * 10n ** BigInt(MONEY_SCALE) + BigInt(fraction.padEnd(MONEY_SCALE, '0'));
}

function scaledFromDecimalString(value: string, field: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  const scaled =
    BigInt(whole) * 10n ** BigInt(MONEY_SCALE) +
    BigInt(fraction.padEnd(MONEY_SCALE, '0').slice(0, MONEY_SCALE));
  if (scaled <= 0n) {
    throw new ReloadlySupplierError('INVALID_PROVIDER_SKU', `${field} must be greater than zero`);
  }
  return scaled;
}

function formatScaled(scaled: bigint): string {
  const base = 10n ** BigInt(MONEY_SCALE);
  const fraction = (scaled % base).toString().padStart(MONEY_SCALE, '0').replace(/0+$/u, '');
  const whole = (scaled / base).toString();
  return fraction === '' ? whole : `${whole}.${fraction}`;
}

/**
 * Re-encodes a fixed-point amount as the JSON number Reloadly's order endpoint
 * insists on. The round trip is asserted rather than assumed: if the double
 * cannot carry the exact decimal we intend to be charged for, no order is sent.
 */
function toWireNumber(scaled: bigint, field: string): number {
  const text = formatScaled(scaled);
  const wire = Number(text);
  if (!Number.isFinite(wire) || formatScaled(scaledFromJsonNumber(wire, field)) !== text) {
    throw new ReloadlySupplierError('AMOUNT_NOT_REPRESENTABLE', `${field} cannot be sent exactly`);
  }
  return wire;
}

export interface ReloadlyProductRef {
  readonly productId: number;
  /** Fixed point, `MONEY_SCALE` decimals, in the product's recipient currency. */
  readonly unitPriceScaled: bigint;
}

export function parseProviderSku(providerSku: string): ReloadlyProductRef {
  const match = PROVIDER_SKU_PATTERN.exec(providerSku.trim());
  if (match === null) {
    throw new ReloadlySupplierError(
      'INVALID_PROVIDER_SKU',
      'Reloadly provider SKU must look like `<productId>:<unitPrice>`',
    );
  }
  const [, rawId = '', rawPrice = ''] = match;
  const productId = Number(rawId);
  if (!Number.isSafeInteger(productId) || productId < 1) {
    throw new ReloadlySupplierError('INVALID_PROVIDER_SKU', 'Reloadly product id must be positive');
  }
  return { productId, unitPriceScaled: scaledFromDecimalString(rawPrice, 'unitPrice') };
}

export function formatProviderSku(productId: number, unitPrice: string): string {
  return `${productId}:${unitPrice}`;
}

/**
 * Reloadly's `errorCode` is a machine token (`PRODUCT_NOT_FOUND`,
 * `INVALID_TOKEN`, …), not prose, so it can be carried into our own vocabulary
 * without leaking a provider message. Anything unrecognised is namespaced and
 * stripped to `[A-Z0-9_]` so an operator still sees *which* refusal it was.
 */
function normaliseErrorCode(payload: unknown, fallback: string): string {
  const code = isObject(payload) ? trimmed(payload['errorCode']) : null;
  if (code === null) {
    return fallback;
  }
  const safe = code.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 60);
  return safe === '' ? fallback : `PROVIDER_${safe}`;
}

/**
 * Terminal for automation unless proven otherwise.
 *
 * An unrecognised status is never optimistically read as success: the caller
 * turns UNKNOWN into a human work item, and turning it into SUCCEEDED would
 * deliver a card we may not own.
 */
function mapTransactionStatus(status: string | null): SupplierPurchaseResult['status'] {
  switch (status) {
    case 'SUCCESSFUL':
    case 'SUCCESS':
      return 'SUCCEEDED';
    case 'PROCESSING':
    case 'PENDING':
      return 'PENDING';
    case 'FAILED':
    case 'REFUNDED':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

interface ReloadlyResponse {
  readonly status: number;
  readonly payload: unknown;
}

/**
 * Reloadly gift-card adapter: buys a card and brings its redeem code back.
 *
 * Three properties are worth stating up front, because each one is a decision
 * rather than an implementation detail.
 *
 * **Idempotency.** `SupplierPurchaseRequest.idempotencyKey` is sent as
 * Reloadly's `customIdentifier`, and every purchase *first* asks whether a
 * transaction already carries that identifier. A retry after a lost response
 * therefore adopts the existing order instead of buying a second card. The
 * lookup filters client-side as well, so a query parameter the venue chose to
 * ignore could never make us adopt somebody else's transaction.
 *
 * **Delivery.** The order is always addressed to our own mailbox, never to the
 * customer, even when the caller supplies `recipientEmail`. Reloadly e-mails
 * the recipient directly, and that mail names the supplier — which would tell
 * the customer who we buy from. The code reaches the customer through our own
 * encrypted delivery path instead.
 *
 * **Secrets.** The access token, the card number and the PIN exist only as
 * local values here. Nothing in this file logs, and the code leaves in
 * `SupplierPurchaseResult.asset`, which the caller hands straight to
 * fulfillment for encryption.
 */
export class ReloadlyGiftCardSupplierProvider implements SupplierProvider {
  readonly key = 'reloadly';

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly baseUrl: string;
  private readonly authUrl: string;
  private readonly recipientEmail: string;
  private readonly senderName: string;
  private readonly timeoutMs: number;
  private readonly clock: Clock;

  private token: { readonly value: string; readonly expiresAt: number } | null = null;
  /** Collapses concurrent purchases onto one token request. */
  private tokenInFlight: Promise<string> | null = null;

  constructor(options: ReloadlyGiftCardSupplierProviderOptions) {
    const clientId = options.clientId.trim();
    const clientSecret = options.clientSecret.trim();
    const recipientEmail = options.recipientEmail.trim();
    if (clientId === '' || clientSecret === '') {
      throw new RangeError('Reloadly client id and secret are required');
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/u.test(recipientEmail)) {
      throw new RangeError('Reloadly recipient e-mail must be a valid address');
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError('Reloadly timeout must be a positive safe integer');
    }

    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.recipientEmail = recipientEmail;
    this.senderName = options.senderName?.trim() || 'Barat Pay';
    this.baseUrl = (options.baseUrl ?? BASE_URLS[options.environment ?? 'production']).replace(
      /\/+$/u,
      '',
    );
    this.authUrl = options.authUrl ?? AUTH_URL;
    this.timeoutMs = timeoutMs;
    this.clock = options.clock ?? (() => new Date());
  }

  /* ==========================================================================
   * Account
   * ========================================================================*/

  /**
   * What the prepaid account can still spend.
   *
   * `frozenBalance` is subtracted whenever the venue reports one. If the two
   * figures already overlap the result is an underestimate, and an underestimate
   * only ever sends an order to an operator — whereas an overestimate sends it
   * to `POST /orders` with insufficient funds, which is the one outcome that can
   * leave a half-placed order behind.
   */
  async getBalance(): Promise<SupplierBalance> {
    const response = await this.call({ method: 'GET', path: '/accounts/balance' });
    const payload = this.expectOk(response, 'BALANCE_UNAVAILABLE');
    if (!isObject(payload)) {
      throw new ReloadlySupplierError('INVALID_RESPONSE', 'Reloadly balance payload is unusable');
    }

    const balance = scaledFromJsonNumber(payload['balance'], 'balance');
    const frozenRaw = payload['frozenBalance'];
    const frozen =
      frozenRaw === undefined || frozenRaw === null
        ? 0n
        : scaledFromJsonNumber(frozenRaw, 'frozenBalance');
    const available = balance - frozen;

    return {
      amount: formatScaled(available < 0n ? 0n : available),
      currency: trimmed(payload['currencyCode']) ?? 'USD',
      /*
       * `updatedAt` arrives as `YYYY-MM-DD HH:mm:ss` with no zone, so parsing it
       * would invent a timezone. The observation time we can state truthfully is
       * the moment we asked.
       */
      observedAt: this.clock(),
    };
  }

  /* ==========================================================================
   * Catalog and pricing
   * ========================================================================*/

  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    const items: SupplierCatalogItem[] = [];

    for (let page = 1; page <= MAX_CATALOG_PAGES; page += 1) {
      const response = await this.call({
        method: 'GET',
        path: `/products?size=${CATALOG_PAGE_SIZE}&page=${page}`,
      });
      const payload = this.expectOk(response, 'CATALOG_UNAVAILABLE');
      if (!isObject(payload) || !Array.isArray(payload['content'])) {
        throw new ReloadlySupplierError('INVALID_RESPONSE', 'Reloadly catalog page was not a page');
      }

      for (const entry of payload['content']) {
        items.push(...this.toCatalogItems(entry));
      }
      if (payload['last'] === true || payload['content'].length === 0) {
        break;
      }
    }

    return items;
  }

  /**
   * What one unit costs us, in Reloadly's sender currency.
   *
   * The figure deliberately *excludes* the volume discount and includes every
   * fee. Reloadly settles the discount against the account rather than the
   * order, and the exact amount only becomes knowable in the transaction that
   * `purchase` returns. Quoting the undiscounted price keeps the estimate on
   * the safe side of the margin: it can leave money on the table, never sell a
   * card below what it turns out to cost.
   */
  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const ref = parseProviderSku(providerSku);
    const product = await this.fetchProduct(ref.productId);
    const senderScaled = this.senderAmountFor(product, ref);

    const feeScaled = scaledFromJsonNumber(product['senderFee'] ?? 0, 'senderFee');
    const feePercentBps = this.percentageToBps(product['senderFeePercentage'], 'senderFeePercentage');
    const percentFeeScaled = (senderScaled * BigInt(feePercentBps)) / 10_000n;

    return {
      providerSku,
      cost: {
        amount: formatScaled(senderScaled + feeScaled + percentFeeScaled),
        currency: this.senderCurrency(product),
      },
      observedAt: this.clock(),
    };
  }

  /**
   * A product is available when Reloadly still sells it *and* still sells the
   * exact denomination we mapped. A transport failure is UNKNOWN, never
   * UNAVAILABLE: an unreachable venue is not a sold-out one, and reporting it
   * as sold out would silently divert orders to a costlier supplier.
   */
  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    const observedAt = this.clock();
    let ref: ReloadlyProductRef;
    try {
      ref = parseProviderSku(providerSku);
    } catch {
      return { providerSku, availability: 'UNAVAILABLE', observedAt };
    }

    let availability: SupplierAvailability;
    try {
      const product = await this.fetchProduct(ref.productId);
      const sellable = product['status'] === 'ACTIVE';
      availability = sellable && this.offersDenomination(product, ref) ? 'AVAILABLE' : 'UNAVAILABLE';
    } catch (error) {
      availability =
        error instanceof ReloadlySupplierError && error.code === 'PRODUCT_NOT_FOUND'
          ? 'UNAVAILABLE'
          : 'UNKNOWN';
    }

    return { providerSku, availability, observedAt: this.clock() };
  }

  /* ==========================================================================
   * Purchase
   * ========================================================================*/

  async purchase(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResult> {
    /*
     * Everything that can be refused without spending money is refused before
     * the first call. A rejection here costs nothing; the same rejection after
     * `POST /orders` would leave a card we cannot deliver.
     */
    if (request.quantity !== 1) {
      /*
       * Reloadly issues one card per unit, and an order carries exactly one
       * delivery asset downstream. Buying five cards to hand over one is not a
       * degraded outcome, it is four cards of silent loss.
       */
      return { status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' };
    }
    const identifier = request.idempotencyKey.trim();
    if (identifier === '' || identifier.length > MAX_CUSTOM_IDENTIFIER_LENGTH) {
      return { status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' };
    }

    let ref: ReloadlyProductRef;
    try {
      ref = parseProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    /*
     * The adoption step. If a previous attempt reached Reloadly — even one
     * whose response we never saw — its transaction is already out there under
     * this identifier, and the only correct move is to return it.
     */
    const existing = await this.findTransactionByIdentifier(identifier);
    if (existing !== null) {
      return this.settleTransaction(existing);
    }

    /*
     * Past this point we have a positive answer that no order exists under this
     * key, so anything that goes wrong while preparing the request is a plain
     * FAILED. Reporting UNKNOWN here would raise a "did we buy a card?" work
     * item for a question we can already answer: no.
     */
    let body: JsonObject;
    try {
      const product = await this.fetchProduct(ref.productId);
      if (product['status'] !== 'ACTIVE' || !this.offersDenomination(product, ref)) {
        return { status: 'FAILED', failureCode: 'DENOMINATION_NOT_AVAILABLE' };
      }
      body = {
        productId: ref.productId,
        countryCode: this.countryCode(product),
        quantity: 1,
        unitPrice: toWireNumber(ref.unitPriceScaled, 'unitPrice'),
        customIdentifier: identifier,
        senderName: this.senderName,
        recipientEmail: this.recipientEmail,
      };
    } catch (error) {
      return {
        status: 'FAILED',
        failureCode: error instanceof ReloadlySupplierError ? error.code : 'ORDER_NOT_PREPARED',
      };
    }

    const response = await this.call({ method: 'POST', path: '/orders', body });

    if (response.status === 200 || response.status === 201) {
      return this.settleTransaction(response.payload);
    }

    /*
     * A refusal Reloadly states explicitly is terminal and safe to report as
     * FAILED — it did not charge us. Anything else (5xx, a shape we do not
     * recognise) is UNKNOWN, because the order may well have been placed.
     */
    if (response.status >= 400 && response.status < 500) {
      return {
        status: 'FAILED',
        failureCode: normaliseErrorCode(response.payload, 'PROVIDER_REJECTED'),
      };
    }
    return {
      status: 'UNKNOWN',
      failureCode: normaliseErrorCode(response.payload, 'PROVIDER_UNAVAILABLE'),
    };
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    const reference = providerReference.trim();
    if (!/^\d{1,19}$/u.test(reference)) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
    }

    const response = await this.call({ method: 'GET', path: `/reports/transactions/${reference}` });
    if (response.status === 404) {
      /*
       * Not proof that nothing was bought. A transaction can be missing because
       * the order never landed or because the ledger has not caught up, and the
       * two are indistinguishable from here.
       */
      return { status: 'UNKNOWN', providerReference, failureCode: 'TRANSACTION_NOT_FOUND' };
    }
    if (response.status !== 200) {
      return {
        status: 'UNKNOWN',
        providerReference,
        failureCode: normaliseErrorCode(response.payload, 'STATUS_UNAVAILABLE'),
      };
    }

    return this.settleTransaction(response.payload);
  }

  /* ==========================================================================
   * Transaction handling
   * ========================================================================*/

  /**
   * Turns a transaction into a result, fetching the redeem code when — and only
   * when — the transaction actually succeeded.
   */
  private async settleTransaction(payload: unknown): Promise<SupplierPurchaseResult> {
    if (!isObject(payload)) {
      return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
    }

    const transactionId = payload['transactionId'];
    const reference =
      typeof transactionId === 'number' && Number.isSafeInteger(transactionId)
        ? String(transactionId)
        : trimmed(transactionId);
    if (reference === null) {
      return { status: 'UNKNOWN', failureCode: 'TRANSACTION_ID_MISSING' };
    }

    const status = mapTransactionStatus(trimmed(payload['status'])?.toUpperCase() ?? null);
    const cost = this.transactionCost(payload);
    const base = {
      providerReference: reference,
      ...(cost === null ? {} : { cost }),
    };

    if (status !== 'SUCCEEDED') {
      return {
        ...base,
        status,
        ...(status === 'FAILED'
          ? { failureCode: normaliseErrorCode(payload, 'PROVIDER_DECLINED') }
          : {}),
      };
    }

    const asset = await this.fetchRedeemCode(reference);
    if (asset === null) {
      /*
       * Paid for, not yet issued. PENDING keeps the order alive for a status
       * re-check; reporting SUCCEEDED without an asset would make the caller
       * raise a conflict, and FAILED would abandon a card we own.
       */
      return { ...base, status: 'PENDING' };
    }
    if (asset === 'AMBIGUOUS') {
      return { ...base, status: 'UNKNOWN', failureCode: 'UNEXPECTED_CARD_COUNT' };
    }

    return { ...base, status: 'SUCCEEDED', asset };
  }

  /**
   * The redeem code, or `null` while Reloadly is still issuing it.
   *
   * `'AMBIGUOUS'` means the venue returned a number of cards we did not order.
   * That is escalated rather than trimmed: handing over the first of several
   * cards would strand the rest, paid for and undelivered.
   */
  private async fetchRedeemCode(
    reference: string,
  ): Promise<SupplierDeliveryAsset | null | 'AMBIGUOUS'> {
    const response = await this.call({
      method: 'GET',
      path: `/orders/transactions/${reference}/cards`,
    });
    if (response.status === 404) {
      return null;
    }
    if (response.status !== 200) {
      return null;
    }

    const cards = Array.isArray(response.payload)
      ? response.payload
      : isObject(response.payload) && Array.isArray(response.payload['content'])
        ? response.payload['content']
        : null;
    if (cards === null) {
      return 'AMBIGUOUS';
    }
    if (cards.length === 0) {
      return null;
    }
    if (cards.length !== 1) {
      return 'AMBIGUOUS';
    }

    const card = cards[0];
    if (!isObject(card)) {
      return 'AMBIGUOUS';
    }
    const code = trimmed(card['cardNumber']);
    if (code === null) {
      return null;
    }
    const pin = trimmed(card['pinCode']);

    /*
     * The delivery type is read from the card in hand, not declared in advance:
     * the same Reloadly product returns a PIN for some brands and not others,
     * and an asset typed CODE_PIN with no PIN is undeliverable.
     */
    return pin === null
      ? { assetType: 'CODE', code }
      : { assetType: 'CODE_PIN', code, pin };
  }

  /**
   * Finds a transaction previously created under `identifier`.
   *
   * The `customIdentifier` filter is re-applied locally. If the venue ever
   * ignored the query parameter it would answer with an unfiltered ledger, and
   * adopting the first row of that would attach one customer's order to
   * another's card.
   */
  private async findTransactionByIdentifier(identifier: string): Promise<JsonObject | null> {
    const response = await this.call({
      method: 'GET',
      path: `/reports/transactions?customIdentifier=${encodeURIComponent(identifier)}&size=${CATALOG_PAGE_SIZE}`,
    });
    if (response.status === 404) {
      return null;
    }
    const payload = this.expectOk(response, 'IDEMPOTENCY_LOOKUP_FAILED');
    const rows = isObject(payload) && Array.isArray(payload['content']) ? payload['content'] : null;
    if (rows === null) {
      throw new ReloadlySupplierError(
        'IDEMPOTENCY_LOOKUP_FAILED',
        'Reloadly transaction lookup was not a page',
      );
    }

    const matches = rows.filter(
      (row): row is JsonObject => isObject(row) && trimmed(row['customIdentifier']) === identifier,
    );
    if (matches.length === 0) {
      return null;
    }
    if (matches.length > 1) {
      /*
       * Two orders already share our key. Buying a third is the one thing that
       * certainly makes it worse.
       */
      throw new ReloadlySupplierError(
        'DUPLICATE_CUSTOM_IDENTIFIER',
        'Reloadly holds more than one transaction for this idempotency key',
      );
    }
    return matches[0] ?? null;
  }

  /** What the transaction actually cost, when Reloadly states it. */
  private transactionCost(payload: JsonObject): SupplierMoney | null {
    const currency = trimmed(payload['currencyCode']);
    if (currency === null) {
      return null;
    }
    try {
      const amount = scaledFromJsonNumber(payload['amount'], 'amount');
      const fee = scaledFromJsonNumber(payload['fee'] ?? 0, 'fee');
      const discount = scaledFromJsonNumber(payload['discount'] ?? 0, 'discount');
      const total = amount + fee - discount;
      return total < 0n ? null : { amount: formatScaled(total), currency };
    } catch {
      /*
       * An unreadable cost must not fail an otherwise good purchase. The caller
       * treats a missing cost as "not reported" and skips variance analysis,
       * which is the honest outcome.
       */
      return null;
    }
  }

  /* ==========================================================================
   * Product helpers
   * ========================================================================*/

  private async fetchProduct(productId: number): Promise<JsonObject> {
    const response = await this.call({ method: 'GET', path: `/products/${productId}` });
    if (response.status === 404) {
      throw new ReloadlySupplierError('PRODUCT_NOT_FOUND', 'Reloadly product does not exist');
    }
    const payload = this.expectOk(response, 'PRODUCT_UNAVAILABLE');
    if (!isObject(payload) || typeof payload['productId'] !== 'number') {
      throw new ReloadlySupplierError('INVALID_RESPONSE', 'Reloadly product payload is unusable');
    }
    return payload;
  }

  /** True when the mapped denomination is one Reloadly will actually sell. */
  private offersDenomination(product: JsonObject, ref: ReloadlyProductRef): boolean {
    if (product['denominationType'] === 'RANGE') {
      try {
        const min = scaledFromJsonNumber(product['minRecipientDenomination'], 'min');
        const max = scaledFromJsonNumber(product['maxRecipientDenomination'], 'max');
        return ref.unitPriceScaled >= min && ref.unitPriceScaled <= max;
      } catch {
        return false;
      }
    }

    const fixed = product['fixedRecipientDenominations'];
    if (!Array.isArray(fixed)) {
      return false;
    }
    return fixed.some((value) => {
      try {
        return scaledFromJsonNumber(value, 'denomination') === ref.unitPriceScaled;
      } catch {
        return false;
      }
    });
  }

  /**
   * The denomination expressed in the currency we are billed in.
   *
   * For a cross-currency product Reloadly publishes the conversion itself, in
   * `fixedRecipientToSenderDenominationsMap`. Deriving it from
   * `recipientCurrencyToSenderCurrencyExchangeRate` instead would reprice the
   * card with our own rounding and disagree with the invoice.
   */
  private senderAmountFor(product: JsonObject, ref: ReloadlyProductRef): bigint {
    if (this.senderCurrency(product) === trimmed(product['recipientCurrencyCode'])) {
      return ref.unitPriceScaled;
    }

    const map = product['fixedRecipientToSenderDenominationsMap'];
    if (isObject(map)) {
      for (const [recipient, sender] of Object.entries(map)) {
        if (scaledFromDecimalString(recipient, 'denomination') === ref.unitPriceScaled) {
          return scaledFromJsonNumber(sender, 'senderDenomination');
        }
      }
    }
    throw new ReloadlySupplierError(
      'PRICE_UNAVAILABLE',
      'Reloadly publishes no sender-currency price for this denomination',
    );
  }

  private senderCurrency(product: JsonObject): string {
    return trimmed(product['senderCurrencyCode']) ?? 'USD';
  }

  private countryCode(product: JsonObject): string {
    const country = product['country'];
    const iso = isObject(country) ? trimmed(country['isoName']) : null;
    if (iso === null) {
      throw new ReloadlySupplierError('INVALID_RESPONSE', 'Reloadly product has no country');
    }
    return iso.toUpperCase();
  }

  /** Percentages arrive as decimals (`7.5` meaning 7.5%); we keep integer bps. */
  private percentageToBps(value: unknown, field: string): number {
    if (value === undefined || value === null) {
      return 0;
    }
    const scaled = scaledFromJsonNumber(value, field);
    return Number((scaled * 100n) / 10n ** BigInt(MONEY_SCALE));
  }

  private toCatalogItems(entry: unknown): readonly SupplierCatalogItem[] {
    if (!isObject(entry) || typeof entry['productId'] !== 'number') {
      return [];
    }
    const productId = entry['productId'];
    const name = trimmed(entry['productName']) ?? `Reloadly product ${productId}`;
    const brand = isObject(entry['brand']) ? trimmed(entry['brand']['brandName']) : null;
    const country = isObject(entry['country']) ? trimmed(entry['country']['isoName']) : null;
    const currency = trimmed(entry['recipientCurrencyCode']) ?? 'USD';
    const common = {
      name,
      region: country ?? 'GLOBAL',
      /*
       * `CODE` is what every Reloadly card is guaranteed to carry. Whether a PIN
       * comes with it is a per-brand fact only the purchase response settles, so
       * the catalog claims the part that always holds.
       */
      assetType: 'CODE' as const,
      ...(brand === null ? {} : { brand }),
    };

    if (entry['denominationType'] === 'RANGE') {
      const min = entry['minRecipientDenomination'];
      const max = entry['maxRecipientDenomination'];
      if (typeof min !== 'number' || typeof max !== 'number') {
        return [];
      }
      const minText = formatScaled(scaledFromJsonNumber(min, 'min'));
      /*
       * A range has no single face value, so it is listed once at its minimum
       * with the bounds spelled out in the name. An operator mapping this
       * product edits the denomination into the provider SKU deliberately,
       * rather than inheriting whichever end we happened to pick.
       */
      return [
        {
          ...common,
          name: `${name} (${minText}–${formatScaled(scaledFromJsonNumber(max, 'max'))} ${currency})`,
          providerSku: formatProviderSku(productId, minText),
          faceValue: { amount: minText, currency },
        },
      ];
    }

    const fixed = entry['fixedRecipientDenominations'];
    if (!Array.isArray(fixed)) {
      return [];
    }
    return fixed.flatMap((value): readonly SupplierCatalogItem[] => {
      let amount: string;
      try {
        amount = formatScaled(scaledFromJsonNumber(value, 'denomination'));
      } catch {
        return [];
      }
      return [
        {
          ...common,
          providerSku: formatProviderSku(productId, amount),
          faceValue: { amount, currency },
        },
      ];
    });
  }

  /* ==========================================================================
   * Transport
   * ========================================================================*/

  private expectOk(response: ReloadlyResponse, code: string): unknown {
    if (response.status !== 200 && response.status !== 201) {
      throw new ReloadlySupplierError(
        normaliseErrorCode(response.payload, code),
        `Reloadly refused the request with HTTP ${response.status}`,
      );
    }
    return response.payload;
  }

  /**
   * One request, with a single re-authentication retry.
   *
   * The retry exists because a 60-day token can be revoked or rotated at the
   * venue between calls. It is bounded to one attempt and only ever fires on
   * 401, so a genuine credential failure surfaces instead of looping.
   */
  private async call(options: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
  }): Promise<ReloadlyResponse> {
    const first = await this.send(options, await this.authorize(false));
    if (first.status !== 401) {
      return first;
    }
    return this.send(options, await this.authorize(true));
  }

  private async send(
    options: { method: 'GET' | 'POST'; path: string; body?: unknown },
    token: string,
  ): Promise<ReloadlyResponse> {
    const headers: Record<string, string> = {
      accept: ACCEPT_VERSION,
      authorization: `Bearer ${token}`,
    };
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
      throw new ReloadlySupplierError('NETWORK_ERROR', 'Reloadly could not be reached', {
        cause: error,
      });
    }

    return { status: response.status, payload: await this.readJson(response) };
  }

  /** A body that is not JSON is `undefined`, not a thrown parse error. */
  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }

  private async authorize(force: boolean): Promise<string> {
    if (force) {
      this.token = null;
    }
    const cached = this.token;
    if (cached !== null && cached.expiresAt > this.clock().getTime()) {
      return cached.value;
    }
    if (this.tokenInFlight !== null) {
      return this.tokenInFlight;
    }

    this.tokenInFlight = this.requestToken().finally(() => {
      this.tokenInFlight = null;
    });
    return this.tokenInFlight;
  }

  private async requestToken(): Promise<string> {
    let response: Response;
    try {
      response = await fetch(this.authUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials',
          /* The audience is what scopes the token to an environment. */
          audience: this.baseUrl,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ReloadlySupplierError('NETWORK_ERROR', 'Reloadly auth could not be reached', {
        cause: error,
      });
    }

    const payload = await this.readJson(response);
    if (response.status !== 200 || !isObject(payload)) {
      throw new ReloadlySupplierError(
        normaliseErrorCode(payload, 'AUTH_FAILED'),
        `Reloadly refused the credentials with HTTP ${response.status}`,
      );
    }

    const value = trimmed(payload['access_token']);
    const expiresIn = payload['expires_in'];
    if (value === null || typeof expiresIn !== 'number' || !Number.isFinite(expiresIn)) {
      throw new ReloadlySupplierError('AUTH_FAILED', 'Reloadly returned no usable access token');
    }

    /*
     * Expire the cache early. A token that lapses mid-flight costs a retry;
     * one that lapses between the check and the call costs a failed purchase.
     */
    const lifetimeMs = Math.max(0, Math.floor(expiresIn * 1_000) - 60_000);
    this.token = { value, expiresAt: this.clock().getTime() + lifetimeMs };
    return value;
  }
}
