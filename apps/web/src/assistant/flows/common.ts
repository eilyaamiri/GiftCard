import { go, type Context, type Move } from "../engine/machine";
import type { QuoteRequest } from "../services";
import { RequoteRequiredError } from "../services";
import type { AssistantBlock, SessionData } from "../types";

export const MENU = "menu";

export const TEXT = {
  quoteExpired: "قیمت این سفارش به‌روزرسانی شده.",
  quoteFailed: "فعلاً امکان دریافت قیمت وجود نداره.",
  loadFailed: "نتونستم نتایج رو دریافت کنم.",
  notFound: "چیزی با این اسم پیدا نکردم.",
  needLogin: "برای ثبت سفارش لازمه وارد حساب کاربریتون بشید.",
};

/** The lines of «سفارش شما», built only from what the person picked. */
export function summaryLines(data: SessionData): { label: string; value: string }[] {
  const lines: { label: string; value: string }[] = [];
  if (data.product !== undefined) lines.push({ label: "محصول", value: data.product.title });
  if (data.region !== undefined && data.serviceType === "giftCard") lines.push({ label: "منطقه", value: data.region });
  if (data.variant !== undefined) lines.push({ label: "مبلغ کارت", value: data.variant.label });
  if (data.game !== undefined) lines.push({ label: "بازی", value: data.game.title });
  if (data.package !== undefined && data.serviceType !== "steam") {
    lines.push({
      label: data.serviceType === "telegramStars" ? "تعداد استارز" : data.serviceType === "telegramPremium" ? "مدت پرمیوم" : "بسته",
      value: data.package.label,
    });
  }
  if (data.telegramUsername !== undefined) lines.push({ label: "حساب تلگرام", value: data.telegramUsername });
  if (data.steamLogin !== undefined) lines.push({ label: "حساب استیم", value: data.steamLogin });
  if (data.service !== undefined) lines.push({ label: "سرویس", value: data.service.title });
  if (data.custom?.title !== undefined) lines.push({ label: "عنوان", value: data.custom.title });
  if (data.amount !== undefined) lines.push({ label: data.serviceType === "steam" ? "مبلغ شارژ" : "مبلغ", value: `${data.amount} ${data.currency ?? ""}`.trim() });
  return lines;
}

export function quoteRequestOf(data: SessionData): QuoteRequest | null {
  switch (data.serviceType) {
    case "giftCard":
      return data.variant === undefined ? null : { kind: "sku", skuId: data.variant.skuId };
    case "telegramStars":
    case "telegramPremium":
      if (data.package === undefined || data.telegramUsername === undefined) return null;
      return {
        kind: "telegram",
        product: data.serviceType === "telegramStars" ? "stars" : "premium",
        offerId: data.package.offerId,
        username: data.telegramUsername,
      };
    case "steam":
      if (data.package === undefined || data.steamLogin === undefined || data.amount === undefined) return null;
      return { kind: "steam", offerId: data.package.offerId, login: data.steamLogin, amount: data.amount };
    case "gameTopup":
      if (data.package === undefined) return null;
      return { kind: "topup", offerId: data.package.offerId, accountFields: data.gameAccountFields ?? {} };
    case "international":
    case "custom":
      if (data.service === undefined || data.amount === undefined || data.currency === undefined) return null;
      return {
        kind: "service",
        serviceId: data.service.id,
        amount: data.amount,
        currency: data.currency,
        fields: data.serviceFields ?? {},
      };
    default:
      return null;
  }
}

export function isExpired(expiresAt: string, now: number): boolean {
  const at = Date.parse(expiresAt);
  return Number.isNaN(at) || at <= now;
}

export function quoteBlock(ctx: Context): AssistantBlock | null {
  const quote = ctx.data.quote;
  if (quote === undefined) return null;
  return {
    kind: "quote",
    title: "پیش‌فاکتور سفارش",
    lines: summaryLines(ctx.data),
    totalLabel: quote.totalLabel,
    expiresAt: quote.expiresAt,
  };
}

export function authGate(resume: string, ctx: Context): Promise<Move | null> {
  return ctx.userId().then((user) => (user === null ? go("auth.required", { patch: { resume }, history: "none" }) : null));
}

export { RequoteRequiredError };
