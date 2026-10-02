import { checkSearch } from "../validators";
import { go, opt, stay, type Context, type StateDef } from "../engine/machine";
import { TEXT } from "./common";

const choicesOf = (ctx: Context) =>
  ctx.memo(`product:${ctx.data.product?.slug ?? ""}`, () =>
    ctx.data.product === undefined ? Promise.resolve(null) : ctx.services.catalog.productChoices(ctx.data.product.slug),
  );

const searchInput = {
  type: "search",
  action: "SEARCH",
  placeholder: "نام برند یا گیفت کارت، مثلاً iTunes",
  maxLength: 80,
} as const;

export const giftCardStates: Record<string, StateDef> = {
  "gc.search": {
    id: "gc.search",
    flow: "giftCard",
    track: "flow_started",
    on: {
      SEARCH: async (_ctx, value) => {
        const checked = checkSearch(value ?? "");
        return "error" in checked ? stay(checked.error) : go("gc.results", { patch: { query: checked.value } });
      },
    },
    render: async () => ({ message: "چه گیفت کاردی می‌خواین؟ اسم برند یا محصول رو بنویسید.", input: searchInput }),
  },

  "gc.results": {
    id: "gc.results",
    flow: "giftCard",
    failMessage: TEXT.loadFailed,
    on: {
      SEARCH: async (_ctx, value) => {
        const checked = checkSearch(value ?? "");
        return "error" in checked ? stay(checked.error) : go("gc.results", { patch: { query: checked.value }, history: "none" });
      },
      SELECT: async (ctx, slug) => {
        const choices = slug === undefined ? null : await ctx.services.catalog.productChoices(slug);
        if (slug === undefined || choices === null || choices.skus.length === 0) {
          return stay("این گیفت کارت فعلاً موجود نیست.");
        }
        return go("gc.region", { patch: { product: { slug, title: choices.title }, brand: choices.brand } });
      },
    },
    render: async (ctx) => {
      const hits = (await ctx.services.catalog.searchProducts(ctx.data.query ?? "")).slice(0, 8);
      if (hits.length === 0) return { message: TEXT.notFound, input: searchInput };
      return {
        message: "این‌ها رو پیدا کردم. یکی رو انتخاب کنید یا دقیق‌تر جستجو کنید.",
        input: searchInput,
        options: hits.map((h) =>
          opt(h.slug, h.title, "SELECT", h.slug, { description: h.brand, ...(h.imageUrl === null ? {} : { imageUrl: h.imageUrl }) }),
        ),
      };
    },
  },

  "gc.region": {
    id: "gc.region",
    flow: "giftCard",
    failMessage: TEXT.loadFailed,
    guard: async (ctx) => {
      const choices = await choicesOf(ctx);
      if (choices === null || choices.regions.length === 0) {
        return go("gc.results", { patch: { product: undefined }, notice: { text: "این گیفت کارت فعلاً موجود نیست.", tone: "error" } });
      }
      return choices.regions.length === 1 ? go("gc.variant", { patch: { region: choices.regions[0] } }) : null;
    },
    on: {
      SELECT: async (_ctx, region) => (region === undefined ? stay("منطقه معتبر نیست.") : go("gc.variant", { patch: { region } })),
    },
    render: async (ctx) => {
      const choices = await choicesOf(ctx);
      return {
        message: "کارت برای کدوم منطقه باشه؟",
        options: (choices?.regions ?? []).map((r) => opt(r, r, "SELECT", r)),
      };
    },
  },

  "gc.variant": {
    id: "gc.variant",
    flow: "giftCard",
    failMessage: TEXT.loadFailed,
    guard: async (ctx) => {
      const choices = await choicesOf(ctx);
      const has = choices?.skus.some((s) => s.region === ctx.data.region) ?? false;
      return has ? null : go("gc.region", { patch: { region: undefined } });
    },
    on: {
      SELECT: async (ctx, skuId) => {
        const choices = await choicesOf(ctx);
        const sku = choices?.skus.find((s) => s.skuId === skuId && s.region === ctx.data.region);
        if (sku === undefined) return stay("این مبلغ دیگه موجود نیست.");
        return go("checkout.quote", { patch: { variant: { skuId: sku.skuId, label: sku.label } } });
      },
    },
    render: async (ctx) => {
      const choices = await choicesOf(ctx);
      const skus = (choices?.skus ?? []).filter((s) => s.region === ctx.data.region);
      return {
        message: "چه مبلغی می‌خواین؟",
        options: skus.map((s) =>
          opt(s.skuId, s.label, "SELECT", s.skuId, s.priceLabel === null ? {} : { description: s.priceLabel }),
        ),
      };
    },
  },
};
