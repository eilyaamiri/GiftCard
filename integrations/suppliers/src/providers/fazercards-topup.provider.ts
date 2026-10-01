import type {
  SupplierAvailability,
  SupplierAvailabilityResult,
  SupplierBalance,
  SupplierCatalogItem,
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

const DEFAULT_BASE_URL = 'https://api.fzr.cards/api/v2';
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;

/** Every money field this venue documents is a 4-decimal string (see class doc for sources). */
const MONEY_SCALE = 4;
const MONEY_UNIT = 10n ** BigInt(MONEY_SCALE);

/** Vendor page caps `Idempotency-Key` at 255 characters; see class doc. */
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

/** One page of `GET /topups`; the docs' own example uses 50, so this stays conservative rather than guessing a ceiling. */
const LIST_PAGE_LIMIT = 100;
const MAX_LIST_PAGES = 50;

/**
 * Offer lists are one request per game. A few at a time keeps a catalogue of
 * hundreds of games inside an HTTP request's patience without looking like a
 * burst to the venue's rate limiter.
 */
const OFFER_FETCH_CONCURRENCY = 4;

/**
 * Catalogue reads retry a throttled or briefly unavailable venue, after these
 * pauses. Short on purpose: an import runs inside one admin request, behind a
 * proxy that gives up after two minutes. Purchases are never retried here.
 */
const CATALOG_RETRY_DELAYS_MS = [500, 1_500] as const;
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([429, 502, 503, 504]);

type JsonObject = Record<string, unknown>;

/** Adapter-owned failure. `code` is normalised; a raw provider message never travels inside it. */
export class FazerCardsTopUpSupplierError extends Error {
  readonly code: string;
  /** The venue's HTTP status, when it answered at all. */
  readonly httpStatus?: number;

  constructor(code: string, message: string, options?: { cause?: unknown; httpStatus?: number }) {
    super(message, options);
    this.name = 'FazerCardsTopUpSupplierError';
    this.code = code;
    if (options?.httpStatus !== undefined) {
      this.httpStatus = options.httpStatus;
    }
  }
}

export interface FazerCardsTopUpSupplierProviderOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
  readonly timeoutMs?: number;
  readonly clock?: () => Date;
  /** The pause between catalogue retries; injectable so tests do not wait. */
  readonly sleep?: (ms: number) => Promise<void>;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function trimmed(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** `category_id:offer_id` — both halves come straight from the venue's own ids. */
const PROVIDER_SKU_PATTERN = /^([^:]+):([^:]+)$/u;

export interface FazerCardsTopUpOfferRef {
  readonly categoryId: string;
  readonly offerId: string;
}

export function parseFazerCardsTopUpProviderSku(providerSku: string): FazerCardsTopUpOfferRef {
  const match = PROVIDER_SKU_PATTERN.exec(providerSku.trim());
  if (match === null) {
    throw new FazerCardsTopUpSupplierError(
      'INVALID_PROVIDER_SKU',
      'FazerCards top-up provider SKU must look like `<category_id>:<offer_id>`',
    );
  }
  const [, categoryId = '', offerId = ''] = match;
  return { categoryId, offerId };
}

export function formatFazerCardsTopUpProviderSku(categoryId: string, offerId: string): string {
  return `${categoryId}:${offerId}`;
}

/** Parses one of this venue's fixed 4-decimal amount strings into fixed point. */
function parseAmount(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d{1,12}\.\d{1,4}$/u.test(value.trim())) {
    throw new FazerCardsTopUpSupplierError('INVALID_RESPONSE', `${field} is not a usable amount`);
  }
  const [whole = '0', fraction = ''] = value.trim().split('.');
  return BigInt(whole) * MONEY_UNIT + BigInt(fraction.padEnd(MONEY_SCALE, '0'));
}

function formatAmount(scaled: bigint): string {
  const whole = scaled / MONEY_UNIT;
  const fraction = (scaled % MONEY_UNIT).toString().padStart(MONEY_SCALE, '0');
  return `${whole}.${fraction}`;
}

/**
 * The docs' error envelope is `{ ok: false, error: "prose", code: "OPTIONAL" }`
 * with `code` explicitly optional — unlike ReSellCodes, whose `error.type` is
 * always present. A missing code falls back to the caller-supplied default.
 */
function normaliseErrorCode(payload: unknown, fallback: string): string {
  const code = isObject(payload) ? trimmed(payload['code']) : null;
  if (code === null) {
    return fallback;
  }
  const safe = code.toUpperCase().replace(/[^A-Z0-9_]/gu, '_').slice(0, 60);
  return safe === '' ? fallback : `PROVIDER_${safe}`;
}

/** Terminal for automation unless proven otherwise — mirrors the ReSellCodes top-up adapter's rule. */
function mapOrderStatus(status: string | null): SupplierPurchaseResult['status'] {
  switch (status) {
    case 'COMPLETED':
      return 'SUCCEEDED';
    case 'CREATED':
    case 'PROCESSING':
      return 'PENDING';
    case 'FAILED':
    case 'REFUNDED':
      return 'FAILED';
    default:
      return 'UNKNOWN';
  }
}

/** The first usable string among `keys` on `source`. */
function firstString(source: JsonObject, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = trimmed(source[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/**
 * Anything that reads as a secret the customer would have to hand us: a
 * password, a PIN, a one-time or recovery code. Matched against a field's key
 * and label. A false positive only hides a game an operator can look at; a
 * false negative would ask a customer for their password, so this errs wide.
 */
const CREDENTIAL_PATTERN =
  /pass(?:word|wd|code)?|pwd|(?:^|[^a-z])pin(?:[^a-z]|$)|otp|2fa|two[-_ ]?factor|verification[-_ ]?code|auth(?:entication)?[-_ ]?code|backup[-_ ]?code|recovery|security[-_ ]?(?:code|question|answer)|secret|token/iu;

const MAX_PATTERN_LENGTH = 500;
const MAX_IMAGE_URL_LENGTH = 2048;

/** Where the documented and plausible shapes put a category's account fields. */
const FIELD_LIST_KEYS = ['fields', 'account_fields', 'required_fields', 'inputs'] as const;

function humanise(key: string): string {
  const spaced = key.replace(/[_-]+/gu, ' ').trim();
  return spaced === '' ? key : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function parseOptions(value: unknown): readonly { label: string; value: string }[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      const plain = trimmed(entry);
      if (plain !== null) {
        return [{ label: plain, value: plain }];
      }
      if (!isObject(entry)) {
        return [];
      }
      const optionValue = firstString(entry, ['value', 'id', 'key', 'code']);
      if (optionValue === null) {
        return [];
      }
      return [{ label: firstString(entry, ['label', 'name', 'title']) ?? optionValue, value: optionValue }];
    });
  }
  if (isObject(value)) {
    /* `{ "value": "label" }`, a shape some venues use for server lists. */
    return Object.entries(value).flatMap(([optionValue, label]) =>
      optionValue.trim() === '' ? [] : [{ label: trimmed(label) ?? optionValue, value: optionValue.trim() }],
    );
  }
  return [];
}

/**
 * The venue's pattern, kept only if it compiles the way the quote path compiles
 * it (no `u` flag, no added anchors). A pattern we cannot compile would be
 * ignored there anyway; storing it would only mislead the operator.
 */
function parsePattern(value: unknown): string | undefined {
  const pattern = trimmed(value);
  if (pattern === null || pattern.length > MAX_PATTERN_LENGTH) {
    return undefined;
  }
  try {
    new RegExp(pattern);
    return pattern;
  } catch {
    return undefined;
  }
}

function parseField(entry: unknown): SupplierTopUpField | null {
  /* A bare key, as in `required_fields: ["player_id"]`. */
  const bare = trimmed(entry);
  if (bare !== null) {
    return {
      key: bare,
      label: humanise(bare),
      type: 'TEXT',
      required: true,
      credential: CREDENTIAL_PATTERN.test(bare),
    };
  }
  if (!isObject(entry)) {
    return null;
  }
  const key = firstString(entry, ['key', 'name', 'id', 'field']);
  if (key === null) {
    return null;
  }
  const label = firstString(entry, ['label', 'title', 'display_name', 'placeholder']) ?? humanise(key);
  const rawType = (trimmed(entry['type']) ?? 'text').toLowerCase();
  const options = parseOptions(entry['options'] ?? entry['values'] ?? entry['choices']);
  const pattern = parsePattern(entry['pattern'] ?? entry['regex'] ?? entry['validation']);
  const required =
    typeof entry['required'] === 'boolean' ? entry['required'] : entry['optional'] !== true;

  return {
    key,
    label,
    /* A select with no options cannot be rendered as one; the customer types the value instead. */
    type: options.length > 0 ? 'SELECT' : 'TEXT',
    required,
    ...(options.length > 0 ? { options } : {}),
    ...(pattern === undefined ? {} : { pattern }),
    credential: rawType === 'password' || CREDENTIAL_PATTERN.test(key) || CREDENTIAL_PATTERN.test(label),
  };
}

/**
 * The account fields declared on one payload, in the venue's order.
 *
 * The documentation shows `fields: [{ key, label, type }]` on the offers
 * response, but that has not been checked live, so the parser also accepts
 * the neighbouring shapes a venue plausibly uses. An entry without a usable
 * key is skipped rather than coerced: a wrong key would be sent to the venue
 * at purchase time and fail after the customer has paid.
 */
function parseFields(source: unknown): readonly SupplierTopUpField[] {
  if (!isObject(source)) {
    return [];
  }
  for (const listKey of FIELD_LIST_KEYS) {
    const list = source[listKey];
    if (Array.isArray(list)) {
      const fields = list.map(parseField).filter((field): field is SupplierTopUpField => field !== null);
      const seen = new Set<string>();
      return fields.filter((field) => (seen.has(field.key) ? false : (seen.add(field.key), true)));
    }
  }
  return [];
}

const IMAGE_KEYS = ['image_url', 'image', 'icon_url', 'icon', 'logo_url', 'logo', 'cover_url', 'cover', 'thumbnail'];

/** A cover from the category, or its `ui` block when `include_ui` fills one. HTTPS only. */
function parseImageUrl(category: JsonObject): string | null {
  const sources = [category, ...(isObject(category['ui']) ? [category['ui']] : [])];
  for (const source of sources) {
    const url = firstString(source, IMAGE_KEYS);
    if (url !== null && url.startsWith('https://') && url.length <= MAX_IMAGE_URL_LENGTH) {
      return url;
    }
  }
  return null;
}

interface FazerCardsResponse {
  readonly status: number;
  readonly payload: unknown;
}

/** One `/topups` row, kept whole so later parsing can read what the venue actually sent. */
interface FazerCardsCategory {
  readonly categoryId: string;
  readonly name: string;
  readonly raw: JsonObject;
}

/** A connection that failed outright — not one that ran out of time. */
function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof FazerCardsTopUpSupplierError) || error.code !== 'NETWORK_ERROR') {
    return false;
  }
  const cause: unknown = error.cause;
  return !(isObject(cause) && cause['name'] === 'TimeoutError');
}

/** `Promise.all` over `items`, at most `limit` at a time, results in input order. The first rejection wins. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> {
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
 * FazerCards (fazercards.com) game top-up adapter.
 *
 * Built entirely from the reseller's own published documentation — no live
 * account was called while writing this class:
 *
 *   - https://reseller.fazercards.com/en/services/platform-top-ups
 *   - https://reseller.fazercards.com/en/docs (base URL, auth, conventions,
 *     `/topups`, `/topups/offers`, `/topups/order`, `/orders/:orderId`, `/balance`)
 *   - https://reseller.fazercards.com/en/docs/webhooks (order status enum:
 *     `created`, `processing`, `completed`, `failed`, `refunded`, plus an
 *     unlisted remainder)
 *
 * fetched 2026-09-28. Every catalog and order shape below is therefore
 * **inferred from documentation, not verified against a live response** — the
 * same caveat `ResellCodesTopUpSupplierProvider` carried before its catalog
 * calls were checked live. Do not set `FAZERCARDS_TOPUP_ENABLED=true` before
 * that verification happens, and treat any field this class reads optimistically
 * (see inline notes) as provisional.
 *
 * Structurally this mirrors `ResellCodesTopUpSupplierProvider` — same money
 * parsing, error normalisation, and `DIRECT_TOPUP` asset shape — but two things
 * are genuinely different, both because the documented API is different, not
 * because of a different design choice:
 *
 * **Idempotency is the venue's job, not ours.** Unlike ReSellCodes, FazerCards
 * documents a real `Idempotency-Key` header on every order-creation endpoint:
 * "reuse the same key when retrying the *same* request to retrieve its
 * original order rather than create another charge or fulfillment." This
 * class sends `request.idempotencyKey` as that header on every purchase call,
 * so a retry after a timeout is safe by the venue's own contract — there is no
 * process-local "remember what already settled" cache here, unlike the
 * ReSellCodes adapters. What remains local is collapsing concurrent calls that
 * share one key into a single in-flight HTTP request, purely to avoid firing
 * the same idempotent call twice at once from this process.
 *
 * **No regions/brands endpoint is documented for top-ups.** ReSellCodes has
 * `GET /top-ups/brands` to resolve each category's region; the FazerCards docs
 * name no equivalent, so a game's `region` is whatever its `/topups` row
 * carries, else `'GLOBAL'` — a known gap, not a considered default.
 *
 * **Games that want a password are never sold.** Some venues top up by the
 * customer's login rather than a public player id. `getTopUpCatalog` marks any
 * field that reads as a secret (`credential`) and the game as
 * `requiresCredentials`; the catalogue import stores that flag and the quote
 * path refuses such a game outright.
 */
export class FazerCardsTopUpSupplierProvider implements SupplierProvider {
  readonly key = 'fazercards-topup';

  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly clock: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;

  private readonly inFlightPurchases = new Map<string, Promise<SupplierPurchaseResult>>();

  constructor(options: FazerCardsTopUpSupplierProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey === '') {
      throw new RangeError('FazerCards API key is required');
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
      throw new RangeError('FazerCards timeout must be a positive safe integer');
    }

    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/u, '');
    this.timeoutMs = timeoutMs;
    this.clock = options.clock ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /* ==========================================================================
   * Account
   * ========================================================================*/

  async getBalance(): Promise<SupplierBalance> {
    const response = await this.call({ method: 'GET', path: '/balance' });
    const payload = this.expectOk(response, 'BALANCE_UNAVAILABLE');
    if (!isObject(payload)) {
      throw new FazerCardsTopUpSupplierError('INVALID_RESPONSE', 'FazerCards balance payload is unusable');
    }

    return {
      amount: formatAmount(parseAmount(payload['balance'], 'balance')),
      /* Unlike ReSellCodes, this venue's own `/balance` response names its currency explicitly. */
      currency: trimmed(payload['currency']) ?? 'USD',
      observedAt: this.clock(),
    };
  }

  /* ==========================================================================
   * Catalog and pricing
   * ========================================================================*/

  /**
   * The flat view the availability sync reads. Derived from `getTopUpCatalog`
   * so there is one parser: an offer whose price cannot be read is left out,
   * which delists it — it could not be quoted anyway.
   */
  async getCatalog(): Promise<readonly SupplierCatalogItem[]> {
    const games = await this.getTopUpCatalog();
    return games.flatMap((game) =>
      game.offers.flatMap((offer): SupplierCatalogItem[] =>
        offer.cost === null
          ? []
          : [
              {
                providerSku: formatFazerCardsTopUpProviderSku(game.categoryId, offer.offerId),
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

  /**
   * Every game the venue lists, with its account fields and packages.
   *
   * A game whose offers call answers 404 is left out: the venue may still list
   * a category it no longer sells, same as the ReSellCodes precedent. Any other
   * failure fails the whole read — the availability sync delists whatever is
   * missing, so a partial answer here would take games off sale.
   */
  async getTopUpCatalog(): Promise<readonly SupplierTopUpGame[]> {
    return (await this.collectTopUpCatalog(false)).games;
  }

  /**
   * The catalogue import's read: a game whose offers still fail after the
   * retries is reported in `unreadable` rather than failing every other game
   * with it. If no game could be read at all, the problem is the account or
   * the venue, not one game, and the first failure is thrown as it is.
   */
  async readTopUpCatalog(): Promise<SupplierTopUpCatalogRead> {
    return this.collectTopUpCatalog(true);
  }

  private async collectTopUpCatalog(tolerant: boolean): Promise<SupplierTopUpCatalogRead> {
    const categories = await this.fetchAllCategories();
    type Outcome =
      | { readonly category: FazerCardsCategory; readonly read: true; readonly game: SupplierTopUpGame | null }
      | { readonly category: FazerCardsCategory; readonly read: false; readonly error: FazerCardsTopUpSupplierError };
    const outcomes = await mapWithConcurrency(categories, OFFER_FETCH_CONCURRENCY, async (category): Promise<Outcome> => {
      try {
        const listing = await this.fetchOffers(category.categoryId, { retry: true });
        return { category, read: true, game: listing === null ? null : this.toTopUpGame(category, listing) };
      } catch (error) {
        if (!tolerant || !(error instanceof FazerCardsTopUpSupplierError)) {
          throw error;
        }
        return { category, read: false, error };
      }
    });

    const games: SupplierTopUpGame[] = [];
    const unreadable: SupplierTopUpUnreadableGame[] = [];
    let firstError: FazerCardsTopUpSupplierError | null = null;
    for (const outcome of outcomes) {
      if (!outcome.read) {
        firstError ??= outcome.error;
        unreadable.push({
          categoryId: outcome.category.categoryId,
          name: outcome.category.name,
          failureCode: outcome.error.code,
        });
      } else if (outcome.game !== null) {
        games.push(outcome.game);
      }
    }
    if (firstError !== null && unreadable.length === categories.length) {
      throw firstError;
    }
    return { games, unreadable };
  }

  /** Read straight from the same offers list `getCatalog` uses; no per-SKU price endpoint is documented. */
  async getPrice(providerSku: string): Promise<SupplierPrice> {
    const ref = parseFazerCardsTopUpProviderSku(providerSku);
    const offer = await this.fetchOffer(ref);
    return {
      providerSku,
      cost: { amount: formatAmount(parseAmount(offer['price_usd'], 'price_usd')), currency: 'USD' },
      observedAt: this.clock(),
    };
  }

  /**
   * A transport failure is UNKNOWN, never UNAVAILABLE: an unreachable venue is
   * not a sold-out one, and reporting it as sold out would silently divert
   * orders to a costlier supplier.
   */
  async checkAvailability(providerSku: string): Promise<SupplierAvailabilityResult> {
    const observedAt = this.clock();
    let ref: FazerCardsTopUpOfferRef;
    try {
      ref = parseFazerCardsTopUpProviderSku(providerSku);
    } catch {
      return { providerSku, availability: 'UNAVAILABLE', observedAt };
    }

    let availability: SupplierAvailability;
    try {
      /* The documented offer shape carries no `stock` field: being listed is what "available" means here. */
      const offer = await this.fetchOffer(ref);
      const stock = offer['stock'];
      availability = typeof stock === 'number' && stock <= 0 ? 'UNAVAILABLE' : 'AVAILABLE';
    } catch (error) {
      availability =
        error instanceof FazerCardsTopUpSupplierError && error.code === 'OFFER_NOT_FOUND'
          ? 'UNAVAILABLE'
          : 'UNKNOWN';
    }

    return { providerSku, availability, observedAt: this.clock() };
  }

  /* ==========================================================================
   * Purchase
   * ========================================================================*/

  async purchase(request: SupplierPurchaseRequest): Promise<SupplierPurchaseResult> {
    if (request.quantity !== 1) {
      return { status: 'FAILED', failureCode: 'QUANTITY_NOT_SUPPORTED' };
    }
    const identifier = request.idempotencyKey.trim();
    if (identifier === '' || identifier.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return { status: 'FAILED', failureCode: 'IDEMPOTENCY_KEY_UNUSABLE' };
    }
    const accountFields = request.accountFields ?? {};
    if (Object.keys(accountFields).length === 0) {
      return { status: 'FAILED', failureCode: 'ACCOUNT_FIELDS_MISSING' };
    }

    /* Only collapses calls racing within this process; correctness across separate attempts is the venue's `Idempotency-Key` contract (see class doc). */
    const inFlight = this.inFlightPurchases.get(identifier);
    if (inFlight !== undefined) {
      return inFlight;
    }

    const attempt = this.runPurchase(request, identifier, accountFields).finally(() => {
      this.inFlightPurchases.delete(identifier);
    });
    this.inFlightPurchases.set(identifier, attempt);
    return attempt;
  }

  private async runPurchase(
    request: SupplierPurchaseRequest,
    identifier: string,
    accountFields: Readonly<Record<string, string>>,
  ): Promise<SupplierPurchaseResult> {
    let ref: FazerCardsTopUpOfferRef;
    try {
      ref = parseFazerCardsTopUpProviderSku(request.providerSku);
    } catch {
      return { status: 'FAILED', failureCode: 'INVALID_PROVIDER_SKU' };
    }

    const response = await this.call({
      method: 'POST',
      path: '/topups/order',
      body: { category_id: ref.categoryId, offer_id: ref.offerId, fields: accountFields },
      idempotencyKey: identifier,
    });

    const accountReference = Object.entries(accountFields)
      .map(([field, value]) => `${field}=${value}`)
      .join(', ');

    if (response.status === 200 || response.status === 201) {
      const order = isObject(response.payload) ? response.payload['order'] : null;
      return this.settleOrder(order, accountReference);
    }
    if (response.status === 429) {
      /* The platform's own rate limiter is documented to refuse the call before order logic runs — nothing charged. */
      return { status: 'FAILED', failureCode: 'RATE_LIMITED' };
    }
    if (response.status >= 400 && response.status < 500) {
      /* A stated 4xx (including a 409 idempotency-key conflict) is terminal and did not charge us. */
      return { status: 'FAILED', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_REJECTED') };
    }
    /* 5xx or an unreadable body: the order may well have been placed and the account already credited. */
    return { status: 'UNKNOWN', failureCode: normaliseErrorCode(response.payload, 'PROVIDER_UNAVAILABLE') };
  }

  async getPurchaseStatus(providerReference: string): Promise<SupplierPurchaseResult> {
    const reference = providerReference.trim();
    if (!/^ord-[A-Za-z0-9_-]+$/u.test(reference)) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'INVALID_PROVIDER_REFERENCE' };
    }

    const response = await this.call({ method: 'GET', path: `/orders/${encodeURIComponent(reference)}` });
    if (response.status === 404) {
      return { status: 'UNKNOWN', providerReference, failureCode: 'ORDER_NOT_FOUND' };
    }
    if (response.status !== 200) {
      return {
        status: 'UNKNOWN',
        providerReference,
        failureCode: normaliseErrorCode(response.payload, 'STATUS_UNAVAILABLE'),
      };
    }
    const order = isObject(response.payload) ? response.payload['order'] : null;
    return this.settleOrder(order, undefined);
  }

  /* ==========================================================================
   * Order handling
   * ========================================================================*/

  private settleOrder(payload: unknown, fallbackAccountReference: string | undefined): SupplierPurchaseResult {
    if (!isObject(payload)) {
      return { status: 'UNKNOWN', failureCode: 'INVALID_RESPONSE' };
    }

    const providerReference = trimmed(payload['id']);
    if (providerReference === null) {
      return { status: 'UNKNOWN', failureCode: 'ORDER_ID_MISSING' };
    }

    const status = mapOrderStatus(trimmed(payload['status'])?.toUpperCase() ?? null);

    /*
     * No charged-amount field is documented on a top-up order response (unlike
     * ReSellCodes' `charged_usd`), so `cost` is best-effort: present only if a
     * recognisable amount field happens to show up, never asserted as required.
     */
    let cost: SupplierPrice['cost'] | undefined;
    for (const field of ['charged_usd', 'amount_usd', 'price_usd']) {
      try {
        cost = { amount: formatAmount(parseAmount(payload[field], field)), currency: 'USD' };
        break;
      } catch {
        continue;
      }
    }
    const base = { providerReference, ...(cost === undefined ? {} : { cost }) };

    if (status !== 'SUCCEEDED') {
      return {
        ...base,
        status,
        /* Neither a `fail_code` nor an equivalent field is documented on the order object itself; `reason` is a best-effort guess. */
        ...(status === 'FAILED' ? { failureCode: trimmed(payload['reason']) ?? 'PROVIDER_DECLINED' } : {}),
      };
    }

    const accountReference = trimmed(payload['account_reference']) ?? fallbackAccountReference ?? null;
    if (accountReference === null) {
      /* A completed order with no account to point at is not a usable confirmation. */
      return { ...base, status: 'UNKNOWN', failureCode: 'ACCOUNT_REFERENCE_MISSING' };
    }

    return { ...base, status: 'SUCCEEDED', asset: { assetType: 'DIRECT_TOPUP', accountReference } };
  }

  /* ==========================================================================
   * Catalog helpers
   * ========================================================================*/

  /**
   * Follows the documented cursor pagination (`meta.next_cursor`/`has_more`)
   * rather than requesting one oversized page: unlike ReSellCodes, FazerCards'
   * docs describe genuine cursor support for `/topups`, not a venue that
   * silently ignores it — this has not been checked live (see class doc).
   * A page count past `MAX_LIST_PAGES` or a final tally short of `meta.total`
   * fails loudly rather than returning a silently incomplete catalog.
   */
  private async fetchAllCategories(): Promise<readonly FazerCardsCategory[]> {
    const items: FazerCardsCategory[] = [];
    let cursor: string | null = null;
    let total: number | null = null;

    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      /* `include_ui=1` (the spec's own spelling) asks for cover art; a venue that ignores it just sends none. */
      const query = new URLSearchParams({ limit: String(LIST_PAGE_LIMIT), include_ui: '1' });
      if (cursor !== null) {
        query.set('cursor', cursor);
      }
      const response = await this.getWithRetry(`/topups?${query.toString()}`);
      const payload = this.expectOk(response, 'CATALOG_UNAVAILABLE');
      if (!isObject(payload) || !Array.isArray(payload['items'])) {
        throw new FazerCardsTopUpSupplierError('INVALID_RESPONSE', 'FazerCards /topups was not a list');
      }
      for (const entry of payload['items']) {
        const categoryId = isObject(entry) ? trimmed(entry['category_id']) : null;
        if (isObject(entry) && categoryId !== null) {
          items.push({ categoryId, name: trimmed(entry['name']) ?? categoryId, raw: entry });
        }
      }

      const meta = payload['meta'];
      total = isObject(meta) && typeof meta['total'] === 'number' ? meta['total'] : total;
      const hasMore = isObject(meta) ? meta['has_more'] === true : false;
      const nextCursor = isObject(meta) ? trimmed(meta['next_cursor']) : null;
      if (!hasMore || nextCursor === null) {
        if (total !== null && items.length < total) {
          throw new FazerCardsTopUpSupplierError(
            'INCOMPLETE_CATALOG',
            `FazerCards /topups returned ${String(items.length)} of ${String(total)} rows`,
          );
        }
        return items;
      }
      cursor = nextCursor;
    }

    throw new FazerCardsTopUpSupplierError('INCOMPLETE_CATALOG', 'FazerCards /topups did not stop paginating');
  }

  /**
   * The whole offer list comes back in one unpaginated object, with the
   * category's account `fields` — same shape as ReSellCodes. `null` for a 404:
   * the venue may still list a category it no longer sells.
   */
  private async fetchOffers(
    categoryId: string,
    options: { readonly retry?: boolean } = {},
  ): Promise<{ offers: readonly JsonObject[]; payload: JsonObject } | null> {
    const path = `/topups/offers?category_id=${encodeURIComponent(categoryId)}`;
    /* Only catalogue reads retry; a quote or availability check answers at once. */
    const response = options.retry === true ? await this.getWithRetry(path) : await this.call({ method: 'GET', path });
    if (response.status === 404) {
      return null;
    }
    const payload = this.expectOk(response, 'CATALOG_UNAVAILABLE');
    if (!isObject(payload) || !Array.isArray(payload['offers'])) {
      throw new FazerCardsTopUpSupplierError('INVALID_RESPONSE', 'FazerCards offer list was not a list');
    }
    return { offers: payload['offers'].filter(isObject), payload };
  }

  /**
   * Fields come from the offers payload first (where the docs put them), then
   * the category row, then the first offer that declares any — whichever the
   * venue actually fills.
   */
  private toTopUpGame(
    category: FazerCardsCategory,
    listing: { offers: readonly JsonObject[]; payload: JsonObject },
  ): SupplierTopUpGame {
    const candidates = [listing.payload, category.raw, ...listing.offers];
    const fields = candidates.map(parseFields).find((list) => list.length > 0) ?? [];

    const offers = listing.offers.flatMap((offer): SupplierTopUpOffer[] => {
      const offerId = firstString(offer, ['offer_id', 'id']);
      if (offerId === null) {
        return [];
      }
      let cost: SupplierTopUpOffer['cost'] = null;
      try {
        cost = { amount: formatAmount(parseAmount(offer['price_usd'], 'price_usd')), currency: 'USD' };
      } catch {
        /* Imported without a price; quotes re-read it live and refuse if it is still missing. */
      }
      return [{ offerId, name: trimmed(offer['name']) ?? offerId, cost }];
    });

    return {
      categoryId: category.categoryId,
      name: category.name,
      /* No regions/brands endpoint is documented for top-ups (see class doc); a region on the row is used if present. */
      region: firstString(category.raw, ['region', 'country']) ?? 'GLOBAL',
      note: firstString(category.raw, ['note', 'description', 'instructions']),
      imageUrl: parseImageUrl(category.raw),
      fields,
      offers,
      requiresCredentials: fields.some((field) => field.credential),
    };
  }

  private async fetchOffer(ref: FazerCardsTopUpOfferRef): Promise<JsonObject> {
    const offers = (await this.fetchOffers(ref.categoryId))?.offers ?? [];
    const offer = offers.find((entry) => firstString(entry, ['offer_id', 'id']) === ref.offerId);
    if (offer === undefined) {
      throw new FazerCardsTopUpSupplierError('OFFER_NOT_FOUND', 'FazerCards top-up offer does not exist');
    }
    return offer;
  }

  /* ==========================================================================
   * Transport
   * ========================================================================*/

  private expectOk(response: FazerCardsResponse, code: string): unknown {
    if (response.status !== 200 && response.status !== 201) {
      throw new FazerCardsTopUpSupplierError(
        normaliseErrorCode(response.payload, code),
        `FazerCards refused the request with HTTP ${response.status}`,
        { httpStatus: response.status },
      );
    }
    return response.payload;
  }

  /**
   * A catalogue GET that rides out throttling (429), a gateway hiccup
   * (502/503/504) or a dropped connection. A timeout is not retried: it has
   * already spent the whole per-request budget once.
   */
  private async getWithRetry(path: string): Promise<FazerCardsResponse> {
    for (let attempt = 0; ; attempt += 1) {
      const delay = CATALOG_RETRY_DELAYS_MS[attempt];
      let response: FazerCardsResponse;
      try {
        response = await this.call({ method: 'GET', path });
      } catch (error) {
        if (delay === undefined || !isRetryableNetworkError(error)) {
          throw error;
        }
        await this.sleep(delay);
        continue;
      }
      if (delay === undefined || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }
      await this.sleep(delay);
    }
  }

  private async call(options: {
    method: 'GET' | 'POST';
    path: string;
    body?: unknown;
    idempotencyKey?: string;
  }): Promise<FazerCardsResponse> {
    /* Docs list `X-API-Key` first, with `Authorization: Bearer` as an alternative; this adapter uses the dedicated header. */
    const headers: Record<string, string> = { 'x-api-key': this.apiKey };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.idempotencyKey !== undefined) {
      headers['idempotency-key'] = options.idempotencyKey;
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
      throw new FazerCardsTopUpSupplierError('NETWORK_ERROR', 'FazerCards could not be reached', {
        cause: error,
      });
    }

    return { status: response.status, payload: await this.readJson(response) };
  }

  private async readJson(response: Response): Promise<unknown> {
    try {
      return (await response.json()) as unknown;
    } catch {
      return undefined;
    }
  }
}
