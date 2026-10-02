import { checkAmount, checkText, checkUrl } from "../validators";
import { go, opt, stay, type Context, type StateDef } from "../engine/machine";
import { TEXT } from "./common";
import { CREDENTIAL_REFUSAL, SKIP, askable, fieldLoop } from "./fields";

const CUSTOM = "__custom";

const serviceOf = (ctx: Context) =>
  ctx.memo(`service:${ctx.data.service?.id ?? ""}`, () =>
    ctx.data.service === undefined ? Promise.resolve(null) : ctx.services.catalog.serviceChoices(ctx.data.service.id),
  );

function amountState(id: string, next: string): StateDef {
  return {
    id,
    flow: "internationalPayment",
    failMessage: TEXT.loadFailed,
    on: {
      SUBMIT: async (ctx, raw) => {
        const service = ctx.data.serviceType === "custom" ? null : await serviceOf(ctx);
        const checked = checkAmount(raw ?? "", {
          currency: ctx.data.currency ?? "",
          min: service?.minAmount ?? null,
          max: service?.maxAmount ?? null,
        });
        if ("error" in checked) return stay(checked.error);
        return go(next, { patch: { amount: checked.value } });
      },
    },
    render: async (ctx) => {
      const service = ctx.data.serviceType === "custom" ? null : await serviceOf(ctx);
      const limits = [
        service?.minAmount ? `حداقل ${service.minAmount}` : null,
        service?.maxAmount ? `حداکثر ${service.maxAmount}` : null,
      ].filter((x): x is string => x !== null);
      return {
        message: `مبلغ موردنظر رو به ${ctx.data.currency ?? ""} بنویسید.`,
        input: {
          type: "number",
          action: "SUBMIT",
          placeholder: "مثلاً 25",
          ...(limits.length === 0 ? {} : { hint: limits.join(" · ") }),
          maxLength: 20,
        },
      };
    },
  };
}

export const internationalStates: Record<string, StateDef> = {
  "intl.categories": {
    id: "intl.categories",
    flow: "internationalPayment",
    track: "flow_started",
    on: {
      SELECT: async (ctx, value) => {
        if (value === CUSTOM) return go("custom.currency", { patch: { serviceType: "custom" } });
        const known = ctx.services.catalog.serviceCategories().some((c) => c.id === value);
        return known && value !== undefined ? go("intl.services", { patch: { serviceCategory: value } }) : stay("این دسته معتبر نیست.");
      },
    },
    render: async (ctx) => ({
      message: "کدوم دسته از سرویس‌ها؟",
      options: [
        ...ctx.services.catalog.serviceCategories().map((c) => opt(c.id, c.label, "SELECT", c.id)),
        opt(CUSTOM, "سرویس موردنظر من در لیست نیست", "SELECT", CUSTOM, { variant: "ghost" }),
      ],
    }),
  },

  "intl.services": {
    id: "intl.services",
    flow: "internationalPayment",
    failMessage: TEXT.loadFailed,
    on: {
      SELECT: async (ctx, id) => {
        const choices = id === undefined ? null : await ctx.services.catalog.serviceChoices(id);
        if (id === undefined || choices === null) return stay("این سرویس فعلاً در دسترس نیست.");
        const { fields, blocked } = askable(choices.fields);
        if (blocked) return stay(CREDENTIAL_REFUSAL);
        return go("intl.amount", {
          patch: {
            service: { id, title: choices.title },
            currency: choices.currency,
            fieldSpecs: fields,
            fieldIndex: 0,
            serviceFields: {},
          },
        });
      },
    },
    render: async (ctx) => {
      const services = (await ctx.services.catalog.listServices(ctx.data.serviceCategory ?? "")).slice(0, 12);
      if (services.length === 0) return { message: TEXT.notFound };
      return {
        message: "کدوم سرویس؟",
        options: services.map((s) => opt(s.id, s.title, "SELECT", s.id, { description: s.currency })),
      };
    },
  },

  "intl.amount": amountState("intl.amount", "intl.field"),
  "intl.field": fieldLoop("intl.field", "internationalPayment", "serviceFields", "checkout.quote"),

  "custom.currency": {
    id: "custom.currency",
    flow: "internationalPayment",
    failMessage: TEXT.loadFailed,
    track: "custom_payment_started",
    guard: async (ctx) => {
      const currencies = await ctx.memo("custom:currencies", () => ctx.services.catalog.customCurrencies());
      return currencies.length === 1 ? go("custom.title", { patch: { currency: currencies[0] } }) : null;
    },
    on: {
      SELECT: async (ctx, currency) => {
        const currencies = await ctx.memo("custom:currencies", () => ctx.services.catalog.customCurrencies());
        return currency !== undefined && currencies.includes(currency)
          ? go("custom.title", { patch: { currency } })
          : stay("این ارز پشتیبانی نمی‌شه.");
      },
    },
    render: async (ctx) => {
      const currencies = await ctx.memo("custom:currencies", () => ctx.services.catalog.customCurrencies());
      return {
        message: currencies.length === 0 ? "فعلاً پرداخت سفارشی در دسترس نیست." : "پرداخت به چه ارزی انجام بشه؟",
        options: currencies.map((c) => opt(c, c, "SELECT", c)),
      };
    },
  },

  "custom.title": {
    id: "custom.title",
    flow: "internationalPayment",
    on: {
      SUBMIT: async (ctx, raw) => {
        const checked = checkText(raw ?? "", 3, 120, "عنوان");
        return "error" in checked ? stay(checked.error) : go("custom.link", { patch: { custom: { ...ctx.data.custom, title: checked.value } } });
      },
    },
    render: async () => ({
      message: "اسم سرویس یا کاری که می‌خواین پرداخت بشه چیه؟",
      input: { type: "text", action: "SUBMIT", placeholder: "مثلاً اشتراک سالانه فلان سرویس", maxLength: 120 },
    }),
  },

  "custom.link": {
    id: "custom.link",
    flow: "internationalPayment",
    on: {
      SUBMIT: async (ctx, raw) => {
        const checked = checkUrl(raw ?? "");
        return "error" in checked ? stay(checked.error) : go("custom.amount", { patch: { custom: { ...ctx.data.custom, link: checked.value } } });
      },
    },
    render: async () => ({
      message: "لینک صفحهٔ سرویس یا فاکتور رو بفرستید.",
      input: { type: "url", action: "SUBMIT", placeholder: "https://", maxLength: 300 },
    }),
  },

  "custom.amount": amountState("custom.amount", "custom.description"),

  "custom.description": {
    id: "custom.description",
    flow: "internationalPayment",
    on: {
      SUBMIT: async (ctx, raw) => {
        const checked = checkText(raw ?? "", 3, 1000, "توضیحات");
        return "error" in checked ? stay(checked.error) : go("custom.prepare", { patch: { custom: { ...ctx.data.custom, description: checked.value } } });
      },
      SELECT: async (_ctx, value) => (value === SKIP ? go("custom.prepare") : stay("این گزینه معتبر نیست.")),
    },
    render: async () => ({
      message: "اگه توضیحی لازمه بنویسید، وگرنه رد کنید.",
      input: { type: "textarea", action: "SUBMIT", placeholder: "توضیحات (اختیاری)", maxLength: 1000 },
      options: [opt("skip", "رد کردن", "SELECT", SKIP, { variant: "ghost" })],
    }),
  },

  "custom.prepare": {
    id: "custom.prepare",
    flow: "internationalPayment",
    failMessage: TEXT.loadFailed,
    guard: async (ctx) => {
      const choices = await ctx.services.catalog.customService(ctx.data.currency ?? "");
      const link = ctx.data.custom?.link;
      if (choices === null || link === undefined) {
        return go("custom.currency", { patch: { currency: undefined }, notice: { text: "فعلاً پرداخت سفارشی در دسترس نیست.", tone: "error" }, history: "none" });
      }
      const { fields, blocked } = askable(choices.fields.filter((f) => f.key !== "siteUrl"));
      if (blocked) {
        return go("intl.categories", { notice: { text: CREDENTIAL_REFUSAL, tone: "error" }, history: "none" });
      }
      const asked = fields.filter((f) => f.required);
      return go("custom.field", {
        patch: {
          service: { id: choices.id, title: choices.title },
          amount: ctx.data.amount,
          currency: ctx.data.currency,
          serviceFields: { siteUrl: link },
          fieldSpecs: asked,
          fieldIndex: 0,
        },
      });
    },
    on: {},
  },

  "custom.field": fieldLoop("custom.field", "internationalPayment", "serviceFields", "checkout.quote", (d) => d.serviceFields ?? {}),
};
