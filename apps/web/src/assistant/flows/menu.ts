import { go, opt, stay, type StateDef } from "../engine/machine";
import { MENU } from "./common";

export const menuStates: Record<string, StateDef> = {
  [MENU]: {
    id: MENU,
    flow: "mainMenu",
    track: "menu_viewed",
    nav: { back: false, home: false },
    on: {
      SELECT: async (_ctx, value) => {
        switch (value) {
          case "giftCard":
            return go("gc.search", { patch: { serviceType: "giftCard" } });
          case "international":
            return go("intl.categories", { patch: { serviceType: "international" } });
          case "telegram":
            return go("tg.choose");
          case "steam":
            return go("steam.login", { patch: { serviceType: "steam" } });
          case "game":
            return go("game.search", { patch: { serviceType: "gameTopup" } });
          case "orders":
            return go("orders.list");
          case "support":
            return go("support.menu");
          default:
            return stay("این گزینه معتبر نیست.");
        }
      },
    },
    render: async () => ({
      message: "سلام 👋 من دستیار خرید شما هستم. چطور می‌تونم کمکتون کنم؟",
      options: [
        opt("giftCard", "🎁 خرید گیفت کارت", "SELECT", "giftCard"),
        opt("international", "🌍 پرداخت یک سرویس", "SELECT", "international"),
        opt("telegram", "✈️ تلگرام", "SELECT", "telegram"),
        opt("steam", "🕹️ شارژ استیم", "SELECT", "steam"),
        opt("game", "🎮 تاپ‌آپ بازی", "SELECT", "game"),
        opt("orders", "📦 سفارش‌های من", "SELECT", "orders"),
        opt("support", "☎️ ارتباط با ما", "SELECT", "support"),
      ],
    }),
  },
};
