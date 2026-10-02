import { go, opt, stay, type Context, type StateDef } from "../engine/machine";
import { RequoteRequiredError } from "../services";
import { TEXT, isExpired, quoteBlock, quoteRequestOf } from "./common";

const SERVICE_LABEL = (ctx: Context) => ctx.data.serviceType ?? "unknown";

const requote = (text: string) =>
  go("checkout.quote", { patch: { quote: undefined }, notice: { text, tone: "info" }, history: "none" });

/** The API has no custom-request endpoint, so what the person typed travels as a ticket on the order. */
async function fileCustomTicket(ctx: Context, orderId: string, orderNumber: string): Promise<void> {
  const custom = ctx.data.custom ?? {};
  const message = [
    `سفارش ${orderNumber}`,
    `عنوان: ${custom.title ?? ""}`,
    `لینک: ${custom.link ?? ""}`,
    `مبلغ: ${ctx.data.amount ?? ""} ${ctx.data.currency ?? ""}`.trim(),
    ...(custom.description === undefined ? [] : [`توضیحات: ${custom.description}`]),
  ].join("\n");
  await ctx.services.support.createTicket({ orderId, subject: (custom.title ?? "پرداخت سفارشی").slice(0, 120), message });
}

export const checkoutStates: Record<string, StateDef> = {
  /** Prices the cart on the server; a stale quote is replaced, never reused. */
  "checkout.quote": {
    id: "checkout.quote",
    flow: "checkout",
    failMessage: TEXT.quoteFailed,
    on: {},
    guard: async (ctx) => {
      const request = quoteRequestOf(ctx.data);
      if (request === null) return go("menu", { reset: true });
      const existing = ctx.data.quote;
      if (existing !== undefined && !isExpired(existing.expiresAt, ctx.services.now())) return go("checkout.confirm");
      const quote = await ctx.services.quotes.create(request);
      return go("checkout.confirm", { patch: { quote } });
    },
  },

  "checkout.confirm": {
    id: "checkout.confirm",
    flow: "checkout",
    track: "quote_displayed",
    failMessage: TEXT.quoteFailed,
    guard: async (ctx) => {
      const quote = ctx.data.quote;
      if (quote === undefined) return go("checkout.quote", { history: "none" });
      if (isExpired(quote.expiresAt, ctx.services.now())) return requote(TEXT.quoteExpired);
      return null;
    },
    on: {
      CONFIRM: async (ctx) => {
        const quote = ctx.data.quote;
        if (quote === undefined || isExpired(quote.expiresAt, ctx.services.now())) return requote(TEXT.quoteExpired);
        if ((await ctx.userId()) === null) return go("auth.required", { patch: { resume: "checkout.confirm" }, history: "none" });
        ctx.services.analytics.track("order_confirmed", { service: SERVICE_LABEL(ctx) });
        return go("checkout.placing", { history: "none" });
      },
    },
    render: async (ctx) => {
      const block = quoteBlock(ctx);
      return {
        message: "پیش‌فاکتور شما آماده است. اگه درسته تأیید کنید تا به پرداخت بریم.",
        blocks: block === null ? [] : [block],
        options: [opt("confirm", "✅ تأیید و پرداخت", "CONFIRM", undefined, { variant: "primary" })],
      };
    },
  },

  "auth.required": {
    id: "auth.required",
    flow: "checkout",
    track: "login_required",
    guard: async (ctx) => {
      if ((await ctx.userId()) === null) return null;
      const target = ctx.data.resume ?? "menu";
      const fresh = target === "checkout.confirm" ? { quote: undefined } : {};
      return go(target, {
        patch: { resume: undefined, ...fresh },
        history: "none",
        ...(target === "checkout.confirm" ? { notice: { text: "وارد شدید؛ قیمت رو دوباره بررسی کردم.", tone: "info" as const } } : {}),
      });
    },
    on: {},
    render: async () => ({
      message: "برای ثبت سفارش لازمه وارد حساب کاربریتون بشید.",
      options: [opt("login", "ورود با کد یکبار مصرف", "LOGIN", undefined, { variant: "primary" })],
    }),
  },

  /** Order, then payment. Every call is idempotent, so a retry never doubles anything. */
  "checkout.placing": {
    id: "checkout.placing",
    flow: "checkout",
    failMessage: "ثبت سفارش انجام نشد.",
    on: {},
    guard: async (ctx) => {
      const quote = ctx.data.quote;
      if (quote === undefined) return go("checkout.quote", { history: "none" });
      let { orderId, orderNumber } = ctx.data;
      if (orderId === undefined || orderNumber === undefined) {
        try {
          const placed = await ctx.services.checkout.placeOrder(quote);
          orderId = placed.orderId;
          orderNumber = placed.orderNumber;
        } catch (error) {
          if (error instanceof RequoteRequiredError) return requote(TEXT.quoteExpired);
          throw error;
        }
        ctx.services.analytics.track("order_created", { service: SERVICE_LABEL(ctx) });
        if (ctx.data.serviceType === "custom") await fileCustomTicket(ctx, orderId, orderNumber);
      }
      const payment = await ctx.services.checkout.startPayment(orderId, ctx.data.paymentState === "failed");
      ctx.services.analytics.track("payment_started", { service: SERVICE_LABEL(ctx) });
      const patch = { orderId, orderNumber, paymentId: payment.paymentId, paymentState: "pending" as const };
      if (payment.gatewayUrl === null) return go("checkout.verify", { patch, history: "none" });
      return go("checkout.awaiting", { patch, effect: { type: "redirect", url: payment.gatewayUrl }, history: "none" });
    },
  },

  "checkout.awaiting": {
    id: "checkout.awaiting",
    flow: "checkout",
    nav: { back: false },
    on: {
      RESUME: async () => go("checkout.verify", { history: "none" }),
      PAY: async (_ctx, value) =>
        value === "gateway" ? go("checkout.placing", { history: "none" }) : go("checkout.verify", { history: "none" }),
    },
    render: async () => ({
      message: "داریم شما رو به درگاه پرداخت می‌بریم. بعد از پرداخت برگردید همین‌جا؛ وضعیت رو خودکار چک می‌کنم.",
      options: [
        opt("check", "بررسی وضعیت پرداخت", "PAY", "check", { variant: "primary" }),
        opt("gateway", "رفتن به درگاه پرداخت", "PAY", "gateway"),
      ],
    }),
  },

  /** Server truth: the only place a payment is declared paid or failed. */
  "checkout.verify": {
    id: "checkout.verify",
    flow: "checkout",
    failMessage: "نتونستم وضعیت پرداخت رو بررسی کنم.",
    on: {},
    guard: async (ctx) => {
      const paymentId = ctx.data.paymentId;
      if (paymentId === undefined) return go("menu", { reset: true });
      const result = await ctx.services.checkout.verifyPayment(paymentId);
      if (result.outcome === "PAID") {
        ctx.services.analytics.track("payment_succeeded", { service: SERVICE_LABEL(ctx) });
        return go("checkout.success", {
          reset: true,
          patch: { orderId: ctx.data.orderId, orderNumber: ctx.data.orderNumber, paymentState: "paid" },
        });
      }
      if (result.outcome === "FAILED") {
        ctx.services.analytics.track("payment_failed", { service: SERVICE_LABEL(ctx) });
        return go("checkout.failed", { patch: { paymentState: "failed" }, history: "none" });
      }
      return go("checkout.awaiting", { notice: { text: "هنوز نتیجهٔ پرداخت مشخص نشده.", tone: "info" }, history: "none" });
    },
  },

  "checkout.success": {
    id: "checkout.success",
    flow: "checkout",
    nav: { back: false, home: false },
    on: {
      SELECT: async (_ctx, value) =>
        value === "orders" ? go("orders.list") : value === "new" ? go("menu", { reset: true }) : stay("این گزینه معتبر نیست."),
      VIEW_ORDER: async (ctx, value) =>
        value === ctx.data.orderNumber ? go("orders.detail", { patch: { selectedOrder: value } }) : stay("این سفارش پیدا نشد."),
    },
    render: async (ctx) => ({
      message: "پرداخت با موفقیت انجام شد 🎉 سفارش شما ثبت شد.",
      options: [
        opt("view", "مشاهده سفارش", "VIEW_ORDER", ctx.data.orderNumber, { variant: "primary" }),
        opt("orders", "سفارش‌های من", "SELECT", "orders"),
        opt("new", "خرید جدید", "SELECT", "new"),
        opt("home", "⌂ منوی اصلی", "HOME", undefined, { variant: "ghost" }),
      ],
    }),
  },

  "checkout.failed": {
    id: "checkout.failed",
    flow: "checkout",
    nav: { back: false, home: false },
    on: {
      RETRY: async () => go("checkout.placing", { history: "none" }),
      SELECT: async (_ctx, value) => (value === "back" ? go("checkout.confirm", { history: "none" }) : stay("این گزینه معتبر نیست.")),
      VIEW_ORDER: async (ctx, value) =>
        value === ctx.data.orderNumber ? go("orders.detail", { patch: { selectedOrder: value } }) : stay("این سفارش پیدا نشد."),
    },
    render: async (ctx) => ({
      message: "پرداخت تکمیل نشد.",
      tone: "error",
      options: [
        opt("retry", "تلاش مجدد", "RETRY", undefined, { variant: "primary" }),
        ...(ctx.data.orderNumber === undefined ? [] : [opt("view", "مشاهده سفارش", "VIEW_ORDER", ctx.data.orderNumber)]),
        opt("back", "← بازگشت", "SELECT", "back"),
        opt("home", "⌂ منوی اصلی", "HOME", undefined, { variant: "ghost" }),
      ],
    }),
  },
};
