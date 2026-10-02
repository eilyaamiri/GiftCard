import { go, opt, stay, type Context, type StateDef } from "../engine/machine";
import type { TelegramKind } from "../services";
import { TEXT } from "./common";

const kindOf = (ctx: Context): TelegramKind => (ctx.data.serviceType === "telegramPremium" ? "premium" : "stars");
const choicesOf = (ctx: Context) => ctx.memo(`telegram:${kindOf(ctx)}`, () => ctx.services.catalog.telegramChoices(kindOf(ctx)));

export const telegramStates: Record<string, StateDef> = {
  "tg.choose": {
    id: "tg.choose",
    flow: "telegram",
    track: "flow_started",
    on: {
      SELECT: async (_ctx, value) => {
        if (value === "stars") return go("tg.package", { patch: { serviceType: "telegramStars" } });
        if (value === "premium") return go("tg.package", { patch: { serviceType: "telegramPremium" } });
        return stay("این گزینه معتبر نیست.");
      },
    },
    render: async () => ({
      message: "چه سرویسی برای تلگرام می‌خواین؟",
      options: [
        opt("stars", "⭐ Telegram Stars", "SELECT", "stars"),
        opt("premium", "💎 Telegram Premium", "SELECT", "premium"),
      ],
    }),
  },

  "tg.package": {
    id: "tg.package",
    flow: "telegram",
    failMessage: TEXT.loadFailed,
    on: {
      SELECT: async (ctx, offerId) => {
        const pkg = (await choicesOf(ctx))?.packages.find((p) => p.offerId === offerId);
        if (pkg === undefined) return stay("این بسته دیگه موجود نیست.");
        return go("tg.username", { patch: { package: { offerId: pkg.offerId, label: pkg.label } } });
      },
    },
    render: async (ctx) => {
      const choices = await choicesOf(ctx);
      const packages = choices?.packages ?? [];
      if (packages.length === 0) return { message: "فعلاً این سرویس در دسترس نیست." };
      return {
        message: ctx.data.serviceType === "telegramPremium" ? "مدت اشتراک پرمیوم رو انتخاب کنید." : "چند تا استارز می‌خواین؟",
        options: packages.map((p) =>
          opt(p.offerId, p.label, "SELECT", p.offerId, p.priceLabel === null ? {} : { description: p.priceLabel }),
        ),
      };
    },
  },

  "tg.username": {
    id: "tg.username",
    flow: "telegram",
    on: {
      SUBMIT: async (ctx, raw) => {
        const username = ctx.services.validate.username(raw ?? "");
        if (username === null) return stay("نام کاربری تلگرام معتبر نیست؛ مثل @username بنویسید.");
        return go("checkout.quote", { patch: { telegramUsername: username } });
      },
    },
    render: async () => ({
      message: "نام کاربری تلگرام حسابی که باید شارژ بشه رو بفرستید (مثل @username). هیچ‌وقت رمز یا کد ورود تلگرام نمی‌خوایم.",
      input: { type: "username", action: "SUBMIT", placeholder: "@username", maxLength: 40 },
    }),
  },
};
