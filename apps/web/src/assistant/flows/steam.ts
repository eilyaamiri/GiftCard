import { go, stay, type Context, type StateDef } from "../engine/machine";
import { TEXT } from "./common";

const choicesOf = (ctx: Context) => ctx.memo("steam", () => ctx.services.catalog.steamChoices());

export const steamStates: Record<string, StateDef> = {
  "steam.login": {
    id: "steam.login",
    flow: "steam",
    track: "flow_started",
    failMessage: TEXT.loadFailed,
    on: {
      SUBMIT: async (ctx, raw) => {
        const choices = await choicesOf(ctx);
        if (choices === null) return stay("فعلاً شارژ استیم در دسترس نیست.");
        const login = ctx.services.validate.steamLogin(raw ?? "", choices.loginPattern);
        if (login === null) return stay("شناسهٔ ورود استیم معتبر نیست؛ بدون فاصله و دقیقاً مثل صفحهٔ ورود استیم بنویسید.");
        return go("steam.amount", { patch: { package: { offerId: choices.offerId, label: choices.title }, steamLogin: login } });
      },
    },
    render: async (ctx) => {
      const choices = await choicesOf(ctx);
      if (choices === null) return { message: "فعلاً شارژ استیم در دسترس نیست." };
      return {
        message:
          "شناسهٔ ورود (Login) حساب استیم رو بفرستید؛ نه نام نمایشی. هیچ‌وقت رمز عبور یا کد Steam Guard نمی‌خوایم.",
        input: { type: "username", action: "SUBMIT", placeholder: "steam_login", maxLength: 64 },
      };
    },
  },

  "steam.amount": {
    id: "steam.amount",
    flow: "steam",
    on: {
      SUBMIT: async (ctx, raw) => {
        const checked = ctx.services.validate.steamAmount(raw ?? "");
        if ("error" in checked) return stay(checked.error);
        return go("checkout.quote", { patch: { amount: checked.value, currency: "USD" } });
      },
    },
    render: async () => ({
      message: "چند دلار می‌خواین به کیف پول استیم اضافه بشه؟ هر مبلغ دلخواه رو بنویسید.",
      input: { type: "number", action: "SUBMIT", placeholder: "مثلاً 10", hint: "از ۰٫۱۵ تا ۱٬۰۰۰ دلار", maxLength: 10 },
    }),
  },
};
