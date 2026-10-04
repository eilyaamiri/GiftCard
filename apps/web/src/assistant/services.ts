import type { FieldSpec, QuoteView } from "./types";

/**
 * Everything the engine needs from the storefront, as plain view models.
 *
 * The engine owns no business rule: price, availability, identity and payment
 * status all come through here from the same services the website uses
 * (`adapters/web-services.ts`), and are re-read from the server at every step
 * that matters. Tests supply a fake.
 */

export interface ProductHit {
  readonly slug: string;
  readonly title: string;
  readonly brand: string;
  readonly imageUrl: string | null;
}

export interface SkuOption {
  readonly skuId: string;
  readonly region: string;
  readonly label: string;
  /** Indicative only — the quote is the payable number. */
  readonly priceLabel: string | null;
}

export interface ProductChoices {
  readonly title: string;
  readonly brand: string;
  /** Only regions that have at least one purchasable denomination. */
  readonly regions: readonly string[];
  readonly skus: readonly SkuOption[];
}

export interface GameHit {
  readonly slug: string;
  readonly title: string;
  readonly imageUrl: string | null;
}

export interface PackageOption {
  readonly offerId: string;
  readonly label: string;
  readonly priceLabel: string | null;
}

export interface TopUpChoices {
  readonly title: string;
  readonly packages: readonly PackageOption[];
  /** The account identifiers the venue declared — never credentials. */
  readonly fields: readonly FieldSpec[];
}

export type TelegramKind = "stars" | "premium";

/** The Steam wallet product: one template offer whose USD amount the customer types. */
export interface SteamChoices {
  readonly title: string;
  readonly offerId: string;
  /** The venue's own validation pattern for the login, when it declares one. */
  readonly loginPattern: string | null;
}

export interface ServiceHit {
  readonly id: string;
  readonly title: string;
  readonly currency: string;
  readonly minAmount: string | null;
  readonly maxAmount: string | null;
}

export interface ServiceChoices extends ServiceHit {
  /** Declared fields minus the reserved credential keys, plus the required site address. */
  readonly fields: readonly FieldSpec[];
}

export interface OrderView {
  readonly id: string;
  readonly orderNumber: string;
  readonly statusLabel: string;
  readonly totalLabel: string;
  readonly createdLabel: string;
}

export interface SupportChannelView {
  readonly kind: "PHONE" | "TELEGRAM" | "WHATSAPP" | "TICKET";
  readonly title: string;
  readonly description: string;
  readonly href: string;
}

export type QuoteRequest =
  | { readonly kind: "sku"; readonly skuId: string }
  | { readonly kind: "topup"; readonly offerId: string; readonly accountFields: Readonly<Record<string, string>> }
  | { readonly kind: "telegram"; readonly product: TelegramKind; readonly offerId: string; readonly username: string }
  | { readonly kind: "steam"; readonly offerId: string; readonly login: string; readonly amount: string }
  | {
      readonly kind: "service";
      readonly serviceId: string;
      readonly amount: string;
      readonly currency: string;
      readonly fields: Readonly<Record<string, string>>;
    };

export interface PlacedOrder {
  readonly orderId: string;
  readonly orderNumber: string;
}

export interface PaymentStart {
  readonly paymentId: string;
  /** `null` when the provider has no hosted page — go straight to verification. */
  readonly gatewayUrl: string | null;
}

export type PaymentOutcome = "PAID" | "FAILED" | "UNKNOWN";

/** Thrown by `placeOrder` when the price the person saw is no longer the price. */
export class RequoteRequiredError extends Error {
  constructor() {
    super("QUOTE_REQUOTE_REQUIRED");
  }
}

export interface AssistantServices {
  auth: { userId(): Promise<string | null> };
  catalog: {
    searchProducts(query: string): Promise<readonly ProductHit[]>;
    productChoices(slug: string): Promise<ProductChoices | null>;
    searchGames(query: string): Promise<readonly GameHit[]>;
    gameChoices(slug: string): Promise<TopUpChoices | null>;
    telegramChoices(kind: TelegramKind): Promise<TopUpChoices | null>;
    steamChoices(): Promise<SteamChoices | null>;
    serviceCategories(): readonly { readonly id: string; readonly label: string }[];
    listServices(category: string): Promise<readonly ServiceHit[]>;
    serviceChoices(id: string): Promise<ServiceChoices | null>;
    /**
     * The orderable generic service behind «سرویس من در لیست نیست». The API has
     * no custom-request endpoint, so a custom payment is a quote on the generic
     * service, with the title and description filed as a ticket on the order.
     */
    customService(currency: string): Promise<ServiceChoices | null>;
    customCurrencies(): Promise<readonly string[]>;
  };
  quotes: { create(request: QuoteRequest): Promise<QuoteView> };
  checkout: {
    /** Re-reads the quote server-side, accepts it and creates the order. Idempotent per quote. */
    placeOrder(quote: QuoteView): Promise<PlacedOrder>;
    /** Idempotent per order and attempt; `renew` starts a new attempt after a failure. */
    startPayment(orderId: string, renew: boolean): Promise<PaymentStart>;
    verifyPayment(paymentId: string): Promise<{ outcome: PaymentOutcome; message: string }>;
  };
  orders: {
    list(): Promise<readonly OrderView[]>;
    get(orderNumber: string): Promise<OrderView | null>;
  };
  support: {
    channels(): Promise<readonly SupportChannelView[]>;
    createTicket(input: { orderId?: string; subject: string; message: string }): Promise<{ reference: string }>;
  };
  validate: {
    /** Returns the normalized handle, or `null` when it is not acceptable. */
    username(raw: string): string | null;
    /** Returns the normalized Steam login, or `null` when it is not acceptable. */
    steamLogin(raw: string, pattern: string | null): string | null;
    /** Returns the USD amount as a plain decimal string, or an error message. */
    steamAmount(raw: string): { value: string } | { error: string };
    /** Returns the normalized value, or an error message. */
    field(spec: FieldSpec, raw: string): { value: string } | { error: string };
  };
  analytics: { track(event: string, props: Readonly<Record<string, string | number | boolean>>): void };
  now(): number;
}
