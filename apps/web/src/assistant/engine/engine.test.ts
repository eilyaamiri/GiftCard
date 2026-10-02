import { describe, expect, it } from "vitest";
import { startDriver } from "../testing/driver";

const GIFT = "🎁 خرید گیفت کارت";

describe("main menu", () => {
  it("opens with the greeting and the six entries", async () => {
    const d = await startDriver();
    expect(d.last.message).toContain("سلام 👋 من دستیار خرید شما هستم");
    expect(d.last.options.map((o) => o.label)).toEqual([
      GIFT,
      "🌍 پرداخت یک سرویس",
      "✈️ تلگرام",
      "🎮 تاپ‌آپ بازی",
      "📦 سفارش‌های من",
      "☎️ ارتباط با ما",
    ]);
    expect(d.last.navigation).toEqual({ back: false, home: false });
    expect(d.fake.events).toContain("assistant_opened");
  });

  it("refuses an option that was never offered", async () => {
    const d = await startDriver();
    await d.send("SELECT", "does-not-exist");
    expect(d.last.tone).toBe("error");
    expect(d.last.state).toBe("menu");
  });

  it("refuses a search when no search box is shown", async () => {
    const d = await startDriver();
    await d.send("SEARCH", "itunes");
    expect(d.last.state).toBe("menu");
    expect(d.fake.count("searchProducts")).toBe(0);
  });
});

describe("navigation", () => {
  it("BACK returns to the previous step and HOME returns to the menu", async () => {
    const d = await startDriver();
    await d.pick(GIFT);
    expect(d.last.state).toBe("gc.search");
    expect(d.last.navigation.back).toBe(true);
    await d.send("BACK");
    expect(d.last.state).toBe("menu");
    await d.pick(GIFT);
    await d.send("SEARCH", "itunes");
    await d.send("HOME");
    expect(d.last.state).toBe("menu");
  });

  it("RESTART clears the conversation", async () => {
    const d = await startDriver();
    await d.giftCardToQuote();
    await d.send("RESTART");
    expect(d.last.state).toBe("menu");
    const seen = await d.engine.peek("s1");
    expect(seen?.transcript.length ?? 0).toBeLessThan(4);
  });

  it("changing the region invalidates the denomination and the quote", async () => {
    const d = await startDriver();
    await d.giftCardToQuote();
    await d.send("BACK");
    await d.send("BACK");
    expect(d.last.state).toBe("gc.region");
    await d.pick("EU");
    expect(d.last.state).toBe("gc.variant");
    expect(d.last.options.map((o) => o.label)).toEqual(expect.arrayContaining(["۲۵ یورو"]));
    expect(d.last.blocks).toEqual([]);
  });
});

describe("gift card flow", () => {
  it("shows a mandatory quote card and does not place an order until confirmed", async () => {
    const d = await startDriver();
    await d.giftCardToQuote();
    expect(d.last.state).toBe("checkout.confirm");
    const quote = d.last.blocks.find((b) => b.kind === "quote");
    expect(quote).toBeDefined();
    expect(quote && "totalLabel" in quote ? quote.totalLabel : "").toBe("۱۵۰ هزار تومان");
    expect(d.fake.count("placeOrder")).toBe(0);
  });

  it("keeps the search box and says so when nothing matches", async () => {
    const d = await startDriver();
    await d.pick(GIFT);
    await d.send("SEARCH", "zzzzz");
    expect(d.last.message).toContain("چیزی با این اسم پیدا نکردم.");
    expect(d.last.input.type).toBe("search");
  });

  it("refuses a one-character search without calling the catalogue", async () => {
    const d = await startDriver();
    await d.pick(GIFT);
    await d.send("SEARCH", "a");
    expect(d.fake.count("searchProducts")).toBe(0);
    expect(d.last.input.type).toBe("search");
  });

  it("offers a retry when the search fails, and recovers", async () => {
    const d = await startDriver();
    await d.pick(GIFT);
    d.fake.state.searchFails = true;
    await d.send("SEARCH", "itunes");
    expect(d.last.message).toContain("نتونستم نتایج رو دریافت کنم.");
    expect(d.has("تلاش مجدد")).toBe(true);
    d.fake.state.searchFails = false;
    await d.pick("تلاش مجدد");
    expect(d.last.state).toBe("gc.results");
    expect(d.has("iTunes")).toBe(true);
  });

  it("says prices are unavailable when quoting fails, and retries", async () => {
    const d = await startDriver();
    d.fake.state.quoteFails = true;
    await d.pick(GIFT);
    await d.send("SEARCH", "itunes");
    await d.pick("iTunes");
    await d.pick("US");
    await d.pick("۲۵ دلار");
    expect(d.last.message).toContain("فعلاً امکان دریافت قیمت وجود نداره.");
    d.fake.state.quoteFails = false;
    await d.pick("تلاش مجدد");
    expect(d.last.state).toBe("checkout.confirm");
  });
});
