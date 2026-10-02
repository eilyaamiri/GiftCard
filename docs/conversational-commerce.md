# Conversational commerce assistant

A deterministic, rule-based assistant over the existing storefront. It is **not** an AI
chatbot: no LLM, embeddings, intent classifier or any generative component runs at
runtime. Every reply comes from a declarative state machine.

```
Conversation = UI          State machine = brain
Site services = business   Channel adapter = presentation
```

All code lives in `apps/web/src/assistant/` (engine) and `apps/web/src/components/assistant/`
(web adapter). Nothing in `packages/contracts`, `schema.prisma`, `app.module.ts` or
`apps/api` was changed.

## Architecture

```
apps/web/src/
  assistant/                      channel-independent engine (no React/DOM/Next/Telegram)
    types.ts                      request/response/session model
    services.ts                   AssistantServices: the only door to business logic
    engine/{engine,machine,session}.ts
    flows/*                       one file per flow, declared as state tables
    validators/                   input validation for structured fields
    persistence/store.ts          SessionStore + memory and browser stores
    analytics/tracker.ts          funnel events (client CustomEvent "barat:assistant")
    adapters/web-services.ts      AssistantServices over the existing @/lib/* and checkout
    testing/                      fake services + driver used by the tests
  components/assistant/           web presentation: widget, panel, cards, quote card, input
  app/assistant/page.tsx          the phone's full-screen assistant
```

### The contract

```
handle({ sessionId, action, value?, identity }) -> {
  message, input: { type, ... }, options: [{ id, label, action, value }],
  navigation: { back, home }, blocks?, effect?
}
```

The engine never reads message text to decide where it is. State is the explicit
`AssistantSession` (`currentFlow`, `currentState`, `stateHistory`, `data`). Identity is
`{ channel, channelUserId, userId, sessionId }`; a Telegram username is never an identity.

Guarantees the engine enforces:

- **Serialised per session**: two overlapping requests cannot interleave.
- **Only offered options are accepted**: an action that was not in the last response is
  refused, so a stale or forged client cannot jump states.
- **Dependent invalidation**: changing a parent selection (product, region, amount) clears
  what depended on it, including the quote.
- **Global actions** work from every state: BACK, HOME, CANCEL, RESTART, LOGIN, SEARCH,
  SELECT, CONFIRM, PAY, RETRY, VIEW_ORDER, CONTACT_SUPPORT.
- Failures return an error response with a RETRY option; the failed action is replayed.

## Flows

| Flow | Notes |
|---|---|
| mainMenu | Gift card, international payment, Telegram, game top-up, my orders, contact us |
| giftCard | search (debounced) -> product -> region -> denomination -> **quote card** -> confirm |
| telegram | Stars and Premium. Asks only for the public username; never a password, OTP or login code |
| gameTopup | Fields come from the catalogue (`TopUpField`); credential-like fields are dropped |
| internationalPayment | Dynamic categories and services, plus a custom-payment option |
| orderTracking | Own orders, status, detail; support from an order attaches its `orderId` |
| support | Phone, ticket, order tracking |
| checkout | Shared by every purchase flow |

### Quote and confirmation

A priced **Quote card** is mandatory before confirmation. If the quote expires, the
assistant says «قیمت این سفارش به‌روزرسانی شده.», fetches a fresh quote and asks for
confirmation again. A price never changes silently.

### Authentication

Login is an interruptible sub-flow («برای ثبت سفارش لازمه وارد حساب کاربریتون بشید.»).
It hands off to the existing `/login?next=…` and OTP pages, keeps the conversation state,
and resumes at a refreshed quote after sign-in. The assistant never sees or stores an OTP.

### Checkout and payment

States: `checkout.quote -> checkout.confirm -> (auth.required) -> checkout.placing ->
checkout.awaiting -> checkout.verify -> checkout.success | checkout.failed`.

- `placeOrder` **re-reads the quote from the server** and compares amount, status and
  expiry before creating the order. The client's idea of the price is never trusted.
- Idempotency: the order is created with a key derived from the quote, so a double click on
  confirm yields one order. Placing is also guarded by the per-session serialisation.
- Payment uses the existing gateway redirect and returns to `/payment/result`. On reopen
  the assistant runs `RESUME`, which **verifies the payment server-side** instead of
  trusting any return parameter.
- Success: «پرداخت با موفقیت انجام شد 🎉 سفارش شما ثبت شد.»; failure:
  «پرداخت تکمیل نشد.» with retry, view order, back and home.

## Persistence

The session is stored in `sessionStorage` under `barat.assistant.<sessionId>`. It holds
ids, labels and the customer's own non-secret answers (a public Telegram handle, a game
player id). Passwords, OTPs, payment tokens and gift-card codes are never collected, so none
can be stored; nothing is written to `localStorage`. The conversation survives navigation,
refresh, minimising, the login redirect and the payment redirect, and falls back to memory
if storage is unavailable.

## Surfaces

- **Desktop (>= 768px)**: a floating widget on every page, bottom-left, up to 400px wide,
  titled «دستیار خرید», with minimise and reset (no state lost). Escape minimises. It does
  not render on `/assistant`, `/login`, `/otp`.
- **Phone (< 768px)**: no widget. The bottom navigation item **«سفارش‌ها» was replaced by
  «دستیار»**, which opens `/assistant`, a full-screen page above the bottom bar with
  safe-area padding. Orders remain reachable inside the assistant («📦 سفارش‌های من»),
  at `/orders` and in the account panel. No order functionality was removed.
- Both surfaces share one engine and one session, so a conversation continues across them.
- RTL, light and dark through the existing design tokens, 44px touch targets, visible
  focus rings, reduced motion respected.

## Analytics

The engine emits funnel events (`assistant_opened`, flow started, step reached, quote shown,
confirmed, auth required, payment started, completed, failed, abandoned) as a browser
`CustomEvent("barat:assistant")`. `safeProps` allows only an allowlist of non-sensitive
keys, so no code, PIN, OTP, token or free text leaves the engine.

## Telegram readiness

The engine imports nothing browser- or Telegram-specific, and `independence.test.ts`
enforces that. A Telegram bot needs only:

1. a `SessionStore` backed by the database or Redis (the interface is three methods),
2. a renderer mapping `options` to inline keyboard buttons and `input.type` to a prompt,
3. an `AssistantServices` implementation (the web adapter is a template; a bot needs a
   server-side identity linking `channelUserId` to a customer).

## Frozen-file gaps (documented, not worked around)

Per AGENTS.md these files are frozen, so the following are **not** implemented:

- No server-side assistant/draft persistence (sessions are per-tab).
- No `Order.source` column, so orders do not record that they came from the assistant.
- No domain-event bus, so analytics are client-side only.
- No analytics ingestion endpoint.
- No quote-refresh endpoint: a refresh is a new `POST /api/quotes`.
- No Telegram username validation endpoint: only a format check.
- No custom-request endpoint: a custom international payment is a quote on the generic
  service plus a support ticket carrying the typed details.

## Limitations

- If `startPayment` throws after a custom-payment ticket was filed, a retry can file a
  second ticket (the order itself is idempotent).
- A customer who abandons the gateway page sees FAILED or UNKNOWN when they return.
- Sessions do not follow a customer across devices until server-side persistence exists.

## Tests

`pnpm --filter @barat/web test` covers the engine (flows, checkout, idempotency, expiry,
auth resume, payment verify, refusal of unoffered actions), validators, the session store
and an independence guard that fails the build if the engine imports a framework or logs.
Coverage thresholds (75%) include the engine. No Playwright tests were added.
