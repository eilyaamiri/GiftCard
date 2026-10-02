import { checkSearch } from "../validators";
import { go, opt, stay, type Context, type StateDef } from "../engine/machine";
import { TEXT } from "./common";
import { CREDENTIAL_REFUSAL, askable, fieldLoop } from "./fields";

const choicesOf = (ctx: Context) =>
  ctx.memo(`game:${ctx.data.game?.slug ?? ""}`, () =>
    ctx.data.game === undefined ? Promise.resolve(null) : ctx.services.catalog.gameChoices(ctx.data.game.slug),
  );

const searchInput = { type: "search", action: "SEARCH", placeholder: "اسم بازی، مثلاً PUBG", maxLength: 80 } as const;

export const gameStates: Record<string, StateDef> = {
  "game.search": {
    id: "game.search",
    flow: "gameTopup",
    track: "flow_started",
    on: {
      SEARCH: async (_ctx, value) => {
        const checked = checkSearch(value ?? "");
        return "error" in checked ? stay(checked.error) : go("game.results", { patch: { query: checked.value } });
      },
    },
    render: async () => ({ message: "کدوم بازی؟ اسمش رو بنویسید.", input: searchInput }),
  },

  "game.results": {
    id: "game.results",
    flow: "gameTopup",
    failMessage: TEXT.loadFailed,
    on: {
      SEARCH: async (_ctx, value) => {
        const checked = checkSearch(value ?? "");
        return "error" in checked ? stay(checked.error) : go("game.results", { patch: { query: checked.value }, history: "none" });
      },
      SELECT: async (ctx, slug) => {
        const choices = slug === undefined ? null : await ctx.services.catalog.gameChoices(slug);
        if (slug === undefined || choices === null || choices.packages.length === 0) return stay("این بازی فعلاً در دسترس نیست.");
        return go("game.package", { patch: { game: { slug, title: choices.title } } });
      },
    },
    render: async (ctx) => {
      const hits = (await ctx.services.catalog.searchGames(ctx.data.query ?? "")).slice(0, 8);
      if (hits.length === 0) return { message: TEXT.notFound, input: searchInput };
      return {
        message: "این بازی‌ها رو پیدا کردم. یکی رو انتخاب کنید.",
        input: searchInput,
        options: hits.map((g) =>
          opt(g.slug, g.title, "SELECT", g.slug, g.imageUrl === null ? {} : { imageUrl: g.imageUrl }),
        ),
      };
    },
  },

  "game.package": {
    id: "game.package",
    flow: "gameTopup",
    failMessage: TEXT.loadFailed,
    on: {
      SELECT: async (ctx, offerId) => {
        const choices = await choicesOf(ctx);
        const pkg = choices?.packages.find((p) => p.offerId === offerId);
        if (choices === null || pkg === undefined) return stay("این بسته دیگه موجود نیست.");
        const { fields, blocked } = askable(choices.fields);
        if (blocked) return stay(CREDENTIAL_REFUSAL);
        const patch = {
          package: { offerId: pkg.offerId, label: pkg.label },
          fieldSpecs: fields,
          fieldIndex: 0,
          gameAccountFields: {},
        };
        return go(fields.length === 0 ? "checkout.quote" : "game.field", { patch });
      },
    },
    render: async (ctx) => {
      const choices = await choicesOf(ctx);
      return {
        message: "کدوم بسته رو می‌خواین؟",
        options: (choices?.packages ?? []).map((p) =>
          opt(p.offerId, p.label, "SELECT", p.offerId, p.priceLabel === null ? {} : { description: p.priceLabel }),
        ),
      };
    },
  },

  "game.field": fieldLoop("game.field", "gameTopup", "gameAccountFields", "checkout.quote"),
};
