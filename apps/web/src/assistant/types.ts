/**
 * The assistant's wire types.
 *
 * Nothing in `assistant/` outside `adapters/` and `renderers/` may import React,
 * the DOM, Next.js or a Telegram SDK. A channel talks to the engine with
 * `AssistantRequest` and draws an `AssistantResponse`; it never reads the
 * session to decide what to show.
 */

export type Channel = "web" | "telegram";

export const GLOBAL_ACTIONS = [
  "BACK",
  "HOME",
  "CANCEL",
  "RESTART",
  "LOGIN",
  "SEARCH",
  "SELECT",
  "CONFIRM",
  "PAY",
  "RETRY",
  "VIEW_ORDER",
  "CONTACT_SUPPORT",
] as const;

/** `SUBMIT` carries a structured text input; `RESUME` re-checks server truth after a redirect. */
export type ActionId = (typeof GLOBAL_ACTIONS)[number] | "SUBMIT" | "RESUME";

export type FlowId =
  | "mainMenu"
  | "giftCard"
  | "telegram"
  | "gameTopup"
  | "internationalPayment"
  | "orderTracking"
  | "support"
  | "ticket"
  | "checkout";

export type ServiceType =
  | "giftCard"
  | "telegramStars"
  | "telegramPremium"
  | "gameTopup"
  | "international"
  | "custom";

export interface AssistantIdentity {
  readonly channel: Channel;
  /** The channel's stable id for the person — never a display name or @username. */
  readonly channelUserId: string;
}

export interface AssistantRequest {
  readonly sessionId: string;
  readonly action: ActionId;
  readonly value?: string;
  /** Only read when the session does not exist yet. */
  readonly identity?: AssistantIdentity;
}

export type InputType = "none" | "search" | "text" | "textarea" | "username" | "number" | "url" | "email";

export interface InputSpec {
  readonly type: InputType;
  /** The action the submitted text is sent as. */
  readonly action: "SEARCH" | "SUBMIT";
  readonly label?: string;
  readonly placeholder?: string;
  readonly hint?: string;
  readonly maxLength?: number;
}

export interface AssistantOption {
  readonly id: string;
  readonly label: string;
  readonly action: ActionId;
  readonly value?: string;
  readonly description?: string;
  readonly imageUrl?: string;
  readonly badge?: string;
  /** A link-out (phone, chat) instead of an engine action. */
  readonly href?: string;
  readonly variant?: "primary" | "secondary" | "ghost";
}

export interface QuoteLine {
  readonly label: string;
  readonly value: string;
}

export type AssistantBlock =
  | {
      readonly kind: "quote";
      readonly title: string;
      readonly lines: readonly QuoteLine[];
      readonly totalLabel: string;
      readonly expiresAt: string;
    }
  | { readonly kind: "summary"; readonly title: string; readonly lines: readonly QuoteLine[] };

export type AssistantEffect =
  | { readonly type: "login" }
  /** Leave for the payment gateway (absolute URL). */
  | { readonly type: "redirect"; readonly url: string }
  /** Open a page of the site itself (path only). */
  | { readonly type: "navigate"; readonly path: string };

export interface AssistantResponse {
  readonly sessionId: string;
  readonly flow: FlowId;
  readonly state: string;
  readonly message: string;
  readonly tone: "info" | "error";
  readonly input: InputSpec;
  readonly options: readonly AssistantOption[];
  readonly blocks: readonly AssistantBlock[];
  readonly navigation: { readonly back: boolean; readonly home: boolean };
  /** One-shot: stored responses never carry it, so a refresh cannot replay a redirect. */
  readonly effect?: AssistantEffect;
}

/* ---- Session ------------------------------------------------------------- */

export interface FieldSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: "text" | "number" | "email" | "url" | "select";
  readonly required: boolean;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly hint?: string;
  /** The venue's own validation pattern, applied by the adapter. */
  readonly pattern?: string;
}

export interface QuoteView {
  readonly id: string;
  /** IRR as a decimal string — the payable amount; never parsed to Number. */
  readonly finalAmountIrr: string;
  readonly totalLabel: string;
  readonly expiresAt: string;
}

export type PaymentState = "pending" | "failed" | "paid";

export interface SessionData {
  serviceType?: ServiceType;
  query?: string;
  product?: { slug: string; title: string };
  brand?: string;
  region?: string;
  variant?: { skuId: string; label: string };
  game?: { slug: string; title: string };
  package?: { offerId: string; label: string };
  gameAccountFields?: Record<string, string>;
  telegramUsername?: string;
  serviceCategory?: string;
  service?: { id: string; title: string };
  amount?: string;
  currency?: string;
  serviceFields?: Record<string, string>;
  custom?: { title?: string; link?: string; description?: string };
  /** The state to continue at once the person has logged in. */
  resume?: string;
  fieldSpecs?: FieldSpec[];
  fieldIndex?: number;
  quote?: QuoteView;
  orderId?: string;
  orderNumber?: string;
  paymentId?: string;
  paymentState?: PaymentState;
  ticket?: { orderId?: string; orderNumber?: string; subject?: string; reference?: string };
  selectedOrder?: string;
}

export type DataKey = keyof SessionData;

export interface HistoryEntry {
  readonly state: string;
  readonly data: SessionData;
}

export interface TranscriptEntry {
  readonly role: "bot" | "user";
  readonly text: string;
}

export interface AssistantSession {
  readonly sessionId: string;
  readonly channel: Channel;
  readonly channelUserId: string;
  userId: string | null;
  currentFlow: FlowId;
  currentState: string;
  /** Snapshots, newest last. BACK restores the top one. */
  stateHistory: HistoryEntry[];
  data: SessionData;
  /** What the person last saw, so a refresh redraws without refetching. */
  lastResponse: AssistantResponse | null;
  /** Set while the last response is an error view: the request RETRY replays. */
  retry: { action: ActionId; value?: string } | null;
  transcript: TranscriptEntry[];
  updatedAt: number;
}
