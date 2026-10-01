import { describe, expect, it, vi } from "vitest";

class FakeApiClientError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
  }
}

const get = vi.fn();
const topUps = vi.fn();
vi.mock("./api", () => ({
  ApiClientError: FakeApiClientError,
  api: {
    get: (...args: unknown[]) => get(...args),
    topUps: (...args: unknown[]) => topUps(...args),
  },
}));

const {
  buildAccountFields,
  filterGames,
  foldForSearch,
  gameTitle,
  getGameTopUp,
  inputKindOf,
  listGameTopUps,
  regionLabel,
  sortedAvailableOffers,
  validateAccountFields,
} = await import("./game-topups");

type Field = Parameters<typeof validateAccountFields>[0][number];

const PUBG = { id: "g1", slug: "pubg-mobile-uc", name: "PUBG Mobile UC", nameFa: "یوسی پابجی موبایل", region: "GLOBAL" };
const STARS = { id: "g2", slug: "telegram-stars", name: "Telegram Stars", nameFa: "استارز تلگرام" };
const FREE_FIRE = { id: "g3", slug: "free-fire", name: "Free Fire Diamonds", nameFa: null, brandName: "Garena" };

const PLAYER_ID: Field = {
  key: "player_id",
  label: "Player ID",
  fieldType: "NUMBER",
  isRequired: true,
  validationRegex: "^[0-9]{5,12}$",
};
const SERVER: Field = {
  key: "server",
  label: "Server",
  fieldType: "SELECT",
  isRequired: true,
  options: [
    { label: "Asia", value: "asia" },
    { label: "Europe", value: "eu" },
  ],
};
const NICKNAME: Field = { key: "nickname", label: "Nickname", fieldType: "TEXT", isRequired: false };

/* No `mockReset` between tests, for the reason `support-channels.test.ts`
 * gives: each test installs its own implementation instead. */
describe("listGameTopUps", () => {
  it("lists every top-up except the Telegram ones, which have their own page", async () => {
    topUps.mockImplementation(async () => ({ items: [PUBG, STARS, FREE_FIRE] }));

    const games = await listGameTopUps();

    expect(games.map((game) => game.slug)).toEqual(["pubg-mobile-uc", "free-fire"]);
  });

  it("drops a malformed entry without losing the rest of the shelf", async () => {
    topUps.mockImplementation(async () => ({ items: [{ slug: "broken" }, PUBG] }));

    await expect(listGameTopUps()).resolves.toHaveLength(1);
  });

  it("accepts a bare array from an older revision of the route", async () => {
    topUps.mockImplementation(async () => [PUBG]);

    await expect(listGameTopUps()).resolves.toHaveLength(1);
  });

  it("shows an empty shelf, not an error page, when the API is down", async () => {
    topUps.mockImplementation(async () => {
      throw new FakeApiClientError(503);
    });

    await expect(listGameTopUps()).resolves.toEqual([]);
  });

  it("does not swallow a programming error", async () => {
    topUps.mockImplementation(async () => {
      throw new TypeError("boom");
    });

    await expect(listGameTopUps()).rejects.toThrow("boom");
  });
});

describe("getGameTopUp", () => {
  const offer = (id: string, sortOrder: number, isAvailable = true) => ({ id, name: `Offer ${id}`, sortOrder, isAvailable });

  it("returns the game with its available offers in catalogue order", async () => {
    get.mockImplementation(async () => ({
      game: { ...PUBG, fields: [PLAYER_ID], offers: [offer("b", 2), offer("gone", 0, false), offer("a", 1)] },
    }));

    const result = await getGameTopUp("pubg-mobile-uc");

    expect(get).toHaveBeenCalledWith("/api/catalog/top-ups/pubg-mobile-uc");
    expect(result.kind).toBe("game");
    if (result.kind !== "game") return;
    expect(result.offers.map((item) => item.id)).toEqual(["a", "b"]);
    expect(result.game.fields).toEqual([PLAYER_ID]);
  });

  it("encodes the slug so a crafted one cannot reach another route", async () => {
    get.mockImplementation(async () => {
      throw new FakeApiClientError(404);
    });

    await getGameTopUp("../admin");

    expect(get).toHaveBeenCalledWith("/api/catalog/top-ups/..%2Fadmin");
  });

  it("sends a Telegram entry to its own page", async () => {
    get.mockImplementation(async () => ({ game: { ...STARS, offers: [offer("s", 1)] } }));

    await expect(getGameTopUp("telegram-stars")).resolves.toEqual({ kind: "telegram" });
  });

  it("treats a game with nothing on sale as missing", async () => {
    get.mockImplementation(async () => ({ game: { ...PUBG, offers: [offer("gone", 0, false)] } }));

    await expect(getGameTopUp("pubg-mobile-uc")).resolves.toEqual({ kind: "missing" });
  });

  it("treats a 404 and an unreadable body the same way", async () => {
    get.mockImplementation(async () => {
      throw new FakeApiClientError(404);
    });
    await expect(getGameTopUp("nope")).resolves.toEqual({ kind: "missing" });

    get.mockImplementation(async () => ({ game: { slug: "no-id" } }));
    await expect(getGameTopUp("no-id")).resolves.toEqual({ kind: "missing" });
  });
});

describe("sortedAvailableOffers", () => {
  it("keeps the API's order on ties", () => {
    const offers = [
      { id: "x", name: "X", sortOrder: 1 },
      { id: "y", name: "Y", sortOrder: 1 },
      { id: "z", name: "Z", sortOrder: 0 },
    ];

    expect(sortedAvailableOffers(offers).map((item) => item.id)).toEqual(["z", "x", "y"]);
  });
});

describe("search", () => {
  const games = [PUBG, FREE_FIRE];

  it("matches Persian and Latin names and the brand", () => {
    expect(filterGames(games, "پابجی")).toEqual([PUBG]);
    expect(filterGames(games, "pubg")).toEqual([PUBG]);
    expect(filterGames(games, "garena")).toEqual([FREE_FIRE]);
  });

  it("requires every word, in any order", () => {
    expect(filterGames(games, "uc mobile")).toEqual([PUBG]);
    expect(filterGames(games, "mobile diamonds")).toEqual([]);
  });

  it("treats Arabic letter forms and digits as their Persian equivalents", () => {
    expect(foldForSearch("كي ۱۲٣")).toBe(foldForSearch("کی 123"));
    expect(filterGames(games, "پابجي")).toEqual([PUBG]);
  });

  it("returns everything for a blank query", () => {
    expect(filterGames(games, "   ")).toEqual(games);
  });
});

describe("presentation", () => {
  it("prefers the Persian title", () => {
    expect(gameTitle(PUBG)).toBe("یوسی پابجی موبایل");
    expect(gameTitle(FREE_FIRE)).toBe("Free Fire Diamonds");
    expect(gameTitle({ name: "X", nameFa: "  " })).toBe("X");
  });

  it("translates known regions and keeps unknown codes rather than hiding them", () => {
    expect(regionLabel("GLOBAL")).toBe("جهانی");
    expect(regionLabel("global")).toBe("جهانی");
    expect(regionLabel("BR")).toBe("BR");
    expect(regionLabel(null)).toBeNull();
    expect(regionLabel(" ")).toBeNull();
  });

  it("renders a field with options as a select whatever its declared type", () => {
    expect(inputKindOf(SERVER)).toBe("select");
    expect(inputKindOf({ ...SERVER, fieldType: "TEXT" })).toBe("select");
    expect(inputKindOf(PLAYER_ID)).toBe("number");
    expect(inputKindOf({ fieldType: "email", options: null })).toBe("email");
    expect(inputKindOf({ fieldType: "FILE" })).toBe("text");
  });
});

describe("validateAccountFields", () => {
  const fields = [PLAYER_ID, SERVER, NICKNAME];

  it("accepts a complete, well-formed account", () => {
    expect(validateAccountFields(fields, { player_id: "5123456", server: "eu" })).toEqual({});
  });

  it("asks for every missing required field, and only those", () => {
    const errors = validateAccountFields(fields, { player_id: "  ", nickname: "" });

    expect(Object.keys(errors).sort()).toEqual(["player_id", "server"]);
  });

  it("reads Persian digits as the number the customer meant", () => {
    expect(validateAccountFields([PLAYER_ID], { player_id: "۵۱۲۳۴۵۶" })).toEqual({});
  });

  it("applies the venue's pattern", () => {
    expect(validateAccountFields([PLAYER_ID], { player_id: "12" })).toHaveProperty("player_id");
    expect(validateAccountFields([PLAYER_ID], { player_id: "abc12345" })).toHaveProperty("player_id");
  });

  it("does not anchor a pattern the venue left unanchored, like the API", () => {
    const loose: Field = { ...PLAYER_ID, validationRegex: "[0-9]{3}" };

    expect(validateAccountFields([loose], { player_id: "id-123-x" })).toEqual({});
  });

  it("ignores a pattern that does not compile instead of blocking the purchase", () => {
    const broken: Field = { ...PLAYER_ID, validationRegex: "([0-9" };

    expect(validateAccountFields([broken], { player_id: "anything" })).toEqual({});
  });

  it("refuses a value that is not one of the options", () => {
    expect(validateAccountFields([SERVER], { server: "mars" })).toHaveProperty("server");
  });

  it("refuses a value longer than the API accepts", () => {
    expect(validateAccountFields([NICKNAME], { nickname: "x".repeat(257) })).toHaveProperty("nickname");
    expect(validateAccountFields([NICKNAME], { nickname: "x".repeat(256) })).toEqual({});
  });

  it("checks an optional field once the customer has filled it in", () => {
    const optionalId: Field = { ...PLAYER_ID, isRequired: false };

    expect(validateAccountFields([optionalId], {})).toEqual({});
    expect(validateAccountFields([optionalId], { player_id: "1" })).toHaveProperty("player_id");
  });
});

describe("buildAccountFields", () => {
  it("sends exactly the declared keys, trimmed, with blanks left out", () => {
    const result = buildAccountFields([PLAYER_ID, SERVER, NICKNAME], {
      player_id: " ۵۱۲۳۴۵۶ ",
      server: "eu",
      nickname: "   ",
      injected: "value",
    });

    expect(result).toEqual({ player_id: "5123456", server: "eu" });
  });

  it("leaves a select value exactly as the venue published it", () => {
    const persianOption: Field = { ...SERVER, options: [{ label: "سرور ۱", value: "سرور ۱" }] };

    expect(buildAccountFields([persianOption], { server: "سرور ۱" })).toEqual({ server: "سرور ۱" });
  });
});
