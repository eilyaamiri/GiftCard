import type {
  AssistantServices,
  PaymentOutcome,
  ProductChoices,
  QuoteRequest,
  ServiceChoices,
  TopUpChoices,
} from "../services";
import { RequoteRequiredError } from "../services";
import type { QuoteView } from "../types";

export interface Fake {
  readonly services: AssistantServices;
  readonly calls: { name: string; arg?: unknown }[];
  readonly events: string[];
  state: {
    userId: string | null;
    now: number;
    quoteTtlMs: number;
    quoteFails: boolean;
    placeRequotes: boolean;
    outcome: PaymentOutcome;
    searchFails: boolean;
    gatewayUrl: string | null;
  };
  count(name: string): number;
}

const SKUS = [
  { skuId: "sku-us-25", region: "US", label: "۲۵ دلار", priceLabel: null },
  { skuId: "sku-us-50", region: "US", label: "۵۰ دلار", priceLabel: null },
  { skuId: "sku-eu-25", region: "EU", label: "۲۵ یورو", priceLabel: null },
];

const ITUNES: ProductChoices = { title: "iTunes", brand: "Apple", regions: ["US", "EU"], skus: SKUS };

const PUBG: TopUpChoices = {
  title: "PUBG Mobile",
  packages: [{ offerId: "pubg-60", label: "۶۰ UC", priceLabel: null }],
  fields: [
    { key: "player_id", label: "شناسه بازیکن", kind: "text", required: true },
    {
      key: "server",
      label: "سرور",
      kind: "select",
      required: true,
      options: [
        { value: "eu", label: "EU" },
        { value: "as", label: "Asia" },
      ],
    },
  ],
};

const LOGIN_GAME: TopUpChoices = {
  title: "Login Game",
  packages: [{ offerId: "lg-1", label: "بسته", priceLabel: null }],
  fields: [{ key: "account_password", label: "رمز عبور", kind: "text", required: true }],
};

const STARS: TopUpChoices = {
  title: "Stars",
  packages: [
    { offerId: "stars-50", label: "۵۰ استارز", priceLabel: null },
    { offerId: "stars-100", label: "۱۰۰ استارز", priceLabel: null },
  ],
  fields: [],
};

const PREMIUM: TopUpChoices = {
  title: "Premium",
  packages: [{ offerId: "prem-3", label: "۳ ماه", priceLabel: null }],
  fields: [],
};

const NETFLIX: ServiceChoices = {
  id: "svc-netflix",
  title: "Netflix",
  currency: "USD",
  minAmount: "5",
  maxAmount: "100",
  fields: [{ key: "siteUrl", label: "آدرس سایت", kind: "url", required: true }],
};

const GENERIC: ServiceChoices = {
  id: "svc-generic",
  title: "پرداخت سفارشی",
  currency: "USD",
  minAmount: "1",
  maxAmount: null,
  fields: [
    { key: "siteUrl", label: "آدرس سایت", kind: "url", required: true },
    { key: "accountEmail", label: "ایمیل حساب", kind: "email", required: true },
    { key: "invoiceReference", label: "شماره فاکتور", kind: "text", required: false },
  ],
};

const ORDER = {
  id: "o-1",
  orderNumber: "BP-1",
  statusLabel: "پرداخت‌شده",
  totalLabel: "۱۵۰ هزار تومان",
  createdLabel: "۱۴۰۵/۰۱/۰۱",
};

export function createFake(): Fake {
  const calls: Fake["calls"] = [];
  const events: string[] = [];
  const state: Fake["state"] = {
    userId: null,
    now: 1_000_000,
    quoteTtlMs: 10 * 60_000,
    quoteFails: false,
    placeRequotes: false,
    outcome: "PAID",
    searchFails: false,
    gatewayUrl: "https://gateway.test/pay",
  };
  let quoteSeq = 0;
  const orders = new Map<string, { orderId: string; orderNumber: string }>();
  const log = (name: string, arg?: unknown) => {
    calls.push({ name, arg });
  };

  const services: AssistantServices = {
    auth: { userId: async () => state.userId },
    catalog: {
      searchProducts: async (q) => {
        log("searchProducts", q);
        if (state.searchFails) throw new Error("boom");
        return /itunes/iu.test(q) ? [{ slug: "itunes", title: "iTunes", brand: "Apple", imageUrl: null }] : [];
      },
      productChoices: async (slug) => (slug === "itunes" ? ITUNES : null),
      searchGames: async (q) =>
        /pubg/iu.test(q)
          ? [{ slug: "pubg", title: "PUBG Mobile", imageUrl: null }]
          : /login/iu.test(q)
            ? [{ slug: "login", title: "Login Game", imageUrl: null }]
            : [],
      gameChoices: async (slug) => (slug === "pubg" ? PUBG : slug === "login" ? LOGIN_GAME : null),
      telegramChoices: async (kind) => (kind === "stars" ? STARS : PREMIUM),
      steamChoices: async () => ({ title: "شارژ کیف پول استیم", offerId: "steam-template", loginPattern: null }),
      serviceCategories: () => [{ id: "streaming", label: "استریم" }],
      listServices: async () => [{ id: NETFLIX.id, title: NETFLIX.title, currency: "USD", minAmount: "5", maxAmount: "100" }],
      serviceChoices: async (id) => (id === NETFLIX.id ? NETFLIX : null),
      customService: async () => GENERIC,
      customCurrencies: async () => ["USD", "EUR"],
    },
    quotes: {
      create: async (request: QuoteRequest): Promise<QuoteView> => {
        log("quote", request);
        if (state.quoteFails) throw new Error("no price");
        quoteSeq += 1;
        return {
          id: `q-${quoteSeq}`,
          finalAmountIrr: "1500000",
          totalLabel: "۱۵۰ هزار تومان",
          expiresAt: new Date(state.now + state.quoteTtlMs).toISOString(),
        };
      },
    },
    checkout: {
      placeOrder: async (quote) => {
        log("placeOrder", quote.id);
        if (state.placeRequotes) throw new RequoteRequiredError();
        const existing = orders.get(quote.id);
        if (existing !== undefined) return existing;
        const created = { orderId: `o-${orders.size + 1}`, orderNumber: `BP-${orders.size + 1}` };
        orders.set(quote.id, created);
        return created;
      },
      startPayment: async (orderId, renew) => {
        log("startPayment", { orderId, renew });
        return { paymentId: `p-${orderId}`, gatewayUrl: state.gatewayUrl };
      },
      verifyPayment: async (paymentId) => {
        log("verifyPayment", paymentId);
        return { outcome: state.outcome, message: "" };
      },
    },
    orders: {
      list: async () => [ORDER],
      get: async (n) => (n === ORDER.orderNumber ? ORDER : null),
    },
    support: {
      channels: async () => [
        { kind: "PHONE", title: "تماس تلفنی", description: "۰۲۱", href: "tel:+98210000" },
        { kind: "TICKET", title: "تیکت", description: "", href: "/account/support" },
      ],
      createTicket: async (input) => {
        log("ticket", input);
        return { reference: "T-1" };
      },
    },
    validate: {
      username: (raw) => (/^@?[a-z][a-z0-9_]{4,31}$/iu.test(raw.trim()) ? `@${raw.trim().replace(/^@/u, "")}` : null),
      steamLogin: (raw) => (/^\S{2,64}$/u.test(raw.trim()) ? raw.trim() : null),
      steamAmount: (raw) => {
        const value = Number(raw.trim());
        return Number.isFinite(value) && value >= 0.15 && value <= 1000 ? { value: String(value) } : { error: "مبلغ معتبر نیست." };
      },
      field: (spec, raw) => (raw.trim() === "" ? { error: `${spec.label} را وارد کنید.` } : { value: raw.trim() }),
    },
    analytics: { track: (event) => void events.push(event) },
    now: () => state.now,
  };

  return { services, calls, events, state, count: (name) => calls.filter((c) => c.name === name).length };
}
