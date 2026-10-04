import type { CreateQuoteRequest, InternationalServiceDto, QuoteSnapshot } from "@barat/contracts";
import { api, ApiClientError } from "@/lib/api";
import { catalogQueryString } from "@/lib/catalog";
import { getCommerceSessionToken } from "@/lib/commerce-session";
import {
  filterGames,
  gameImageUrl,
  gameTitle,
  getGameTopUp,
  inputKindOf,
  listGameTopUps,
  normalizeAccountValue,
  validateAccountFields,
  type TopUpField,
} from "@/lib/game-topups";
import { GENERIC_SERVICE_SLUGS, SERVICE_CATEGORIES } from "@/lib/service-categories";
import { orderStatusView } from "@/lib/status";
import { getSupportChannels } from "@/lib/support-channels";
import { getSteamTopUp, isValidSteamLogin, normalizeSteamLogin, parseSteamUsdAmount, STEAM_LOGIN_KEY, steamLoginField } from "@/lib/steam";
import { getTelegramProduct, isValidUsername, normalizeUsername, offerLabel, offerQuantity, usernameFieldKey } from "@/lib/telegram";
import {
  acceptQuote,
  createOrder,
  createPayment,
  createQuote,
  gatewayDestination,
  paymentAttempt,
  purchaseError,
  resetPaymentAttempt,
  tomanFromIrr,
  verifyPayment,
} from "@/app/checkout/purchase";
import { trackAssistantEvent } from "../analytics/tracker";
import { RequoteRequiredError, type AssistantServices, type OrderView, type PaymentOutcome, type ServiceChoices, type ServiceHit, type TopUpChoices } from "../services";
import type { FieldSpec, QuoteView } from "../types";
import { checkUrl, isCredentialField } from "../validators";

/**
 * The web channel's `AssistantServices`: a thin mapping onto the helpers the
 * storefront pages already use. No price, availability or payment rule lives
 * here — every number shown comes from the same API calls the pages make, and
 * the order step re-reads the quote from the server before it commits.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const DECIMAL = /^\d+(\.\d+)?$/u;
const MAX_VALUE = 256;
const SITE_URL_KEY = "siteUrl";

function priceLabel(irr: string | null | undefined): string | null {
  if (irr === null || irr === undefined || irr === "") return null;
  try {
    return tomanFromIrr(irr);
  } catch {
    return null;
  }
}

function toFieldSpec(field: TopUpField): FieldSpec {
  return {
    key: field.key,
    label: field.labelFa ?? field.label,
    kind: inputKindOf(field),
    required: field.isRequired,
    ...(field.options !== null && field.options !== undefined && field.options.length > 0
      ? { options: field.options.map((option) => ({ value: option.value, label: option.label })) }
      : {}),
    ...(field.helpTextFa ? { hint: field.helpTextFa } : {}),
    ...(field.validationRegex ? { pattern: field.validationRegex } : {}),
  };
}

function serviceFieldKind(type: string, hasOptions: boolean): FieldSpec["kind"] | null {
  if (hasOptions) return "select";
  switch (type) {
    case "EMAIL":
      return "email";
    case "URL":
      return "url";
    case "NUMBER":
      return "number";
    case "TEXT":
    case "TEXTAREA":
    case "SELECT":
      return "text";
    default:
      return null;
  }
}

function toServiceChoices(service: InternationalServiceDto): ServiceChoices {
  const fields: FieldSpec[] = [];
  for (const field of [...service.fields].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (field.key === SITE_URL_KEY) continue;
    const options = field.options ?? [];
    const kind = serviceFieldKind(field.fieldType, options.length > 0);
    if (kind === null) continue;
    const label = field.labelFa || field.label;
    if (isCredentialField({ key: field.key, label, kind })) continue;
    fields.push({
      key: field.key,
      label,
      kind,
      required: field.isRequired,
      ...(options.length > 0 ? { options: options.map((option) => ({ value: option.value, label: option.labelFa })) } : {}),
      ...(field.helpTextFa ? { hint: field.helpTextFa } : {}),
      ...(field.validationRegex ? { pattern: field.validationRegex } : {}),
    });
  }
  return {
    id: service.id,
    title: service.nameFa || service.name,
    currency: service.currency,
    minAmount: service.minAmount,
    maxAmount: service.maxAmount,
    fields: [{ key: SITE_URL_KEY, label: "آدرس وب‌سایت سرویس", kind: "url", required: true }, ...fields],
  };
}

function toHit(service: InternationalServiceDto): ServiceHit {
  return { id: service.id, title: service.nameFa || service.name, currency: service.currency, minAmount: service.minAmount, maxAmount: service.maxAmount };
}

function isGeneric(service: InternationalServiceDto): boolean {
  return GENERIC_SERVICE_SLUGS.includes(service.slug);
}

function toRequoteOrThrow(error: unknown): never {
  if (error instanceof RequoteRequiredError) throw error;
  if (purchaseError(error).requoteRequired) throw new RequoteRequiredError();
  throw error;
}

const dateFormat = new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium" });

export function createWebServices(): AssistantServices {
  const serviceCache = new Map<string, InternationalServiceDto>();

  async function loadServices(category?: string): Promise<readonly InternationalServiceDto[]> {
    const page = await api.services({ ...(category ? { category } : {}), pageSize: 100 });
    const active = page.items.filter((service) => service.isActive);
    for (const service of active) serviceCache.set(service.id, service);
    return active;
  }

  function toOrder(order: { id: string; orderNumber: string; status: Parameters<typeof orderStatusView>[0]; totalAmountIrr: string; createdAt: string }): OrderView {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      statusLabel: orderStatusView(order.status).label,
      totalLabel: tomanFromIrr(order.totalAmountIrr),
      createdLabel: dateFormat.format(new Date(order.createdAt)),
    };
  }

  async function listOrders(pageSize: number): Promise<readonly OrderView[]> {
    try {
      const page = await api.accountOrders({ pageSize });
      return page.items.map(toOrder);
    } catch (error) {
      if (error instanceof ApiClientError && error.isUnauthenticated) return [];
      throw error;
    }
  }

  return {
    auth: {
      async userId() {
        try {
          const me = await api.me();
          return me.customer?.id ?? null;
        } catch (error) {
          if (error instanceof ApiClientError) return null;
          throw error;
        }
      },
    },

    catalog: {
      async searchProducts(query) {
        const result = await api.products(catalogQueryString({ search: query, pageSize: 8, onlyAvailable: true }));
        return result.items
          .filter((item) => !item.needsReview)
          .map((item) => ({ slug: item.slug, title: item.titleFa || item.title, brand: item.brandNameFa || item.brand, imageUrl: item.imageUrl ?? null }));
      },

      async productChoices(slug) {
        try {
          const { product } = await api.product(slug);
          const purchasable = product.skus.filter((sku) => sku.isActive && sku.isAvailable);
          if (purchasable.length === 0) return null;
          return {
            title: product.titleFa || product.title,
            brand: product.brand,
            regions: [...new Set(purchasable.map((sku) => sku.region))],
            skus: purchasable.map((sku) => ({ skuId: sku.id, region: sku.region, label: sku.denominationLabel, priceLabel: priceLabel(sku.indicativePriceIrr) })),
          };
        } catch (error) {
          if (error instanceof ApiClientError) return null;
          throw error;
        }
      },

      async searchGames(query) {
        const games = filterGames(await listGameTopUps(), query);
        return games.map((game) => ({ slug: game.slug, title: gameTitle(game), imageUrl: gameImageUrl(game) }));
      },

      async gameChoices(slug): Promise<TopUpChoices | null> {
        const lookup = await getGameTopUp(slug);
        if (lookup.kind !== "game") return null;
        return {
          title: gameTitle(lookup.game),
          packages: lookup.offers.map((offer) => ({ offerId: offer.id, label: offer.nameFa || offer.name, priceLabel: priceLabel(offer.indicativePriceIrr) })),
          fields: (lookup.game.fields ?? []).map(toFieldSpec),
        };
      },

      async telegramChoices(kind): Promise<TopUpChoices | null> {
        const entry = await getTelegramProduct(kind);
        if (entry === null) return null;
        return {
          title: entry.game.nameFa || entry.game.name,
          packages: entry.offers.map((offer) => ({ offerId: offer.id, label: offerLabel(kind, offer, offerQuantity(offer)), priceLabel: priceLabel(offer.indicativePriceIrr) })),
          fields: [],
        };
      },

      async steamChoices() {
        const entry = await getSteamTopUp();
        if (entry === null) return null;
        return {
          title: entry.game.nameFa || entry.game.name,
          offerId: entry.offerId,
          loginPattern: steamLoginField(entry.game)?.validationRegex ?? null,
        };
      },

      serviceCategories: () => SERVICE_CATEGORIES.map((category) => ({ id: category.slug, label: category.labelFa })),

      async listServices(category) {
        return (await loadServices(category)).filter((service) => !isGeneric(service)).map(toHit);
      },

      async serviceChoices(id) {
        let service = serviceCache.get(id);
        if (service === undefined) {
          await loadServices();
          service = serviceCache.get(id);
        }
        return service === undefined ? null : toServiceChoices(service);
      },

      async customService(currency) {
        const services = await loadServices();
        const match = services.find((service) => isGeneric(service) && service.currency === currency);
        return match === undefined ? null : toServiceChoices(match);
      },

      async customCurrencies() {
        const services = await loadServices();
        return [...new Set(services.filter(isGeneric).map((service) => service.currency))];
      },
    },

    quotes: {
      async create(request): Promise<QuoteView> {
        const base = { quantity: 1, commerceSessionToken: getCommerceSessionToken() };
        let payload: CreateQuoteRequest;
        switch (request.kind) {
          case "sku":
            payload = { ...base, skuId: request.skuId, currency: "USD" } as CreateQuoteRequest;
            break;
          case "topup":
            payload = { ...base, topUpOfferId: request.offerId, topUpAccountFields: { ...request.accountFields }, currency: "USD" } as CreateQuoteRequest;
            break;
          case "telegram": {
            const entry = await getTelegramProduct(request.product);
            if (entry === null) throw new RequoteRequiredError();
            payload = { ...base, topUpOfferId: request.offerId, topUpAccountFields: { [usernameFieldKey({ fields: entry.game.fields ?? [] })]: request.username }, currency: "USD" } as CreateQuoteRequest;
            break;
          }
          case "steam": {
            const entry = await getSteamTopUp();
            if (entry === null) throw new RequoteRequiredError();
            payload = {
              ...base,
              topUpOfferId: request.offerId,
              requestedAmountForeign: request.amount,
              topUpAccountFields: { [steamLoginField(entry.game)?.key ?? STEAM_LOGIN_KEY]: request.login },
              currency: "USD",
            } as CreateQuoteRequest;
            break;
          }
          case "service":
            payload = { ...base, serviceId: request.serviceId, requestedAmountForeign: request.amount, currency: request.currency, serviceFields: { ...request.fields } } as CreateQuoteRequest;
            break;
        }
        const { quote } = await createQuote(payload);
        return { id: quote.id, finalAmountIrr: quote.finalAmountIrr, totalLabel: tomanFromIrr(quote.finalAmountIrr), expiresAt: quote.expiresAt };
      },
    },

    checkout: {
      async placeOrder(shown) {
        let snapshot: QuoteSnapshot;
        try {
          snapshot = (await api.quote(shown.id)).quote;
        } catch (error) {
          return toRequoteOrThrow(error);
        }
        const usable = snapshot.status === "ACTIVE" ? Date.parse(snapshot.expiresAt) > Date.now() : snapshot.status === "ACCEPTED";
        if (!usable || snapshot.finalAmountIrr !== shown.finalAmountIrr) throw new RequoteRequiredError();
        try {
          const accepted = await acceptQuote(snapshot);
          if (accepted.requoteRequired) throw new RequoteRequiredError();
          const { order } = await createOrder(snapshot);
          return { orderId: order.id, orderNumber: order.orderNumber };
        } catch (error) {
          return toRequoteOrThrow(error);
        }
      },

      async startPayment(orderId, renew) {
        if (renew) resetPaymentAttempt(orderId);
        const { payment, redirectUrl } = await createPayment(orderId, paymentAttempt(orderId));
        return { paymentId: payment.id, gatewayUrl: gatewayDestination(redirectUrl) };
      },

      async verifyPayment(paymentId) {
        const result = await verifyPayment(paymentId);
        const outcome: PaymentOutcome =
          result.outcome === "PAID" || result.outcome === "ALREADY_VERIFIED" ? "PAID" : result.outcome === "FAILED" || result.outcome === "CANCELLED" ? "FAILED" : "UNKNOWN";
        return { outcome, message: result.messageFa };
      },
    },

    orders: {
      list: () => listOrders(20),
      async get(orderNumber) {
        const found = (await listOrders(20)).find((order) => order.orderNumber === orderNumber);
        if (found !== undefined) return found;
        return (await listOrders(100)).find((order) => order.orderNumber === orderNumber) ?? null;
      },
    },

    support: {
      async channels() {
        return (await getSupportChannels()).map((channel) => ({ kind: channel.kind, title: channel.title, description: channel.description, href: channel.href }));
      },
      async createTicket(input) {
        const ticket = await api.createSupportRequest({ ...(input.orderId ? { orderId: input.orderId } : {}), subject: input.subject, message: input.message });
        return { reference: ticket.code };
      },
    },

    validate: {
      username: (raw) => (isValidUsername(raw) ? normalizeUsername(raw) : null),

      steamLogin(raw, pattern) {
        if (!isValidSteamLogin(raw)) return null;
        const login = normalizeSteamLogin(raw);
        if (pattern !== null) {
          try {
            if (!new RegExp(pattern, "u").test(login)) return null;
          } catch {
            return login;
          }
        }
        return login;
      },

      steamAmount(raw) {
        const result = parseSteamUsdAmount(raw);
        if (result.ok) return { value: result.amount };
        const messages = {
          REQUIRED: "مبلغ شارژ را به دلار وارد کنید",
          FORMAT: "مبلغ را به‌صورت عدد و حداکثر با دو رقم اعشار وارد کنید",
          BELOW_MIN: "حداقل مبلغ شارژ ۰٫۱۵ دلار است",
          ABOVE_MAX: "حداکثر مبلغ شارژ ۱٬۰۰۰ دلار است",
        } as const;
        return { error: messages[result.reason] };
      },

      field(spec, raw) {
        const field: TopUpField = {
          key: spec.key,
          label: spec.label,
          fieldType: spec.kind.toUpperCase(),
          isRequired: spec.required,
          options: spec.options ? spec.options.map((option) => ({ label: option.label, value: option.value })) : null,
          validationRegex: spec.pattern ?? null,
        };
        const value = normalizeAccountValue(field, raw);
        const problem = validateAccountFields([field], { [spec.key]: raw })[spec.key];
        if (problem !== undefined) return { error: problem };
        if (value === "") return { value };
        if (value.length > MAX_VALUE) return { error: "مقدار وارد شده بیش از حد طولانی است" };
        if (spec.kind === "url") {
          const checked = checkUrl(value);
          return "error" in checked ? { error: checked.error } : { value: checked.value };
        }
        if (spec.kind === "email" && !EMAIL.test(value)) return { error: "ایمیل را درست وارد کنید." };
        if (spec.kind === "number" && !DECIMAL.test(value)) return { error: "فقط عدد وارد کنید." };
        return { value };
      },
    },

    analytics: { track: (event, props) => trackAssistantEvent(event, props) },
    now: () => Date.now(),
  };
}
