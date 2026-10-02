import { describe, expect, it } from "vitest";
import { startDriver, type Driver } from "../testing/driver";
import { createMemoryStore } from "../persistence/store";
import { createEngine } from "./engine";
import { createFake } from "../testing/fake-services";

const hasQuote = (d: Driver) => d.last.blocks.some((b) => b.kind === "quote");
const quoteRequests = (d: Driver) => d.fake.calls.filter((c) => c.name === "quote").map((c) => c.arg);

describe("telegram", () => {
  it("offers Stars and Premium and never asks for a password or login code", async () => {
    const d = await startDriver();
    await d.pick("✈️ تلگرام");
    expect(d.last.message).toBe("چه سرویسی برای تلگرام می‌خواین؟");
    expect(d.last.options.map((o) => o.label)).toEqual(["⭐ Telegram Stars", "💎 Telegram Premium"]);
  });

  it("Stars: package, username, then a quote", async () => {
    const d = await startDriver();
    await d.pick("✈️ تلگرام");
    await d.pick("⭐ Telegram Stars");
    await d.pick("۱۰۰ استارز");
    expect(d.last.message).toContain("هیچ‌وقت رمز یا کد ورود تلگرام نمی‌خوایم");
    await d.send("SUBMIT", "not a name!");
    expect(d.last.state).toBe("tg.username");
    expect(d.last.tone).toBe("error");
    await d.send("SUBMIT", "@some_user");
    expect(hasQuote(d)).toBe(true);
    expect(quoteRequests(d).at(-1)).toMatchObject({ kind: "telegram", product: "stars", offerId: "stars-100", username: "@some_user" });
  });

  it("Premium follows the same path with its own packages", async () => {
    const d = await startDriver();
    await d.pick("✈️ تلگرام");
    await d.pick("💎 Telegram Premium");
    expect(d.last.options.map((o) => o.label)).toEqual(["۳ ماه"]);
    await d.pick("۳ ماه");
    await d.send("SUBMIT", "@some_user");
    expect(hasQuote(d)).toBe(true);
  });
});

describe("game top-up", () => {
  it("asks the fields the catalogue declares, then quotes", async () => {
    const d = await startDriver();
    await d.pick("🎮 تاپ‌آپ بازی");
    await d.send("SEARCH", "pubg");
    await d.pick("PUBG Mobile");
    await d.pick("۶۰ UC");
    expect(d.last.message).toBe("شناسه بازیکن");
    expect(d.last.input.type).toBe("text");
    await d.send("SUBMIT", "12345");
    expect(d.last.message).toBe("سرور");
    expect(d.last.options.map((o) => o.label)).toEqual(["EU", "Asia"]);
    await d.pick("Asia");
    expect(hasQuote(d)).toBe(true);
    expect(quoteRequests(d).at(-1)).toMatchObject({ kind: "topup", offerId: "pubg-60" });
  });

  it("rejects an empty answer with the field's own error", async () => {
    const d = await startDriver();
    await d.pick("🎮 تاپ‌آپ بازی");
    await d.send("SEARCH", "pubg");
    await d.pick("PUBG Mobile");
    await d.pick("۶۰ UC");
    await d.send("SUBMIT", "   ");
    expect(d.last.state).toBe("game.field");
    expect(d.last.tone).toBe("error");
  });

  it("refuses a game whose required field is a password", async () => {
    const d = await startDriver();
    await d.pick("🎮 تاپ‌آپ بازی");
    await d.send("SEARCH", "login");
    await d.pick("Login Game");
    await d.pick("بسته");
    expect(d.last.tone).toBe("error");
    expect(d.last.message).toContain("رمز");
    expect(d.fake.count("quote")).toBe(0);
  });
});

describe("international payment", () => {
  it("categories → service → amount → fields → quote", async () => {
    const d = await startDriver();
    await d.pick("🌍 پرداخت یک سرویس");
    expect(d.has("سرویس موردنظر من در لیست نیست")).toBe(true);
    await d.pick("استریم");
    await d.pick("Netflix");
    await d.send("SUBMIT", "20");
    await d.send("SUBMIT", "https://netflix.com");
    expect(hasQuote(d)).toBe(true);
    expect(quoteRequests(d).at(-1)).toMatchObject({ kind: "service", serviceId: "svc-netflix", amount: "20", currency: "USD", fields: { siteUrl: "https://netflix.com" } });
  });

  it("enforces the service's amount bounds", async () => {
    const d = await startDriver();
    await d.pick("🌍 پرداخت یک سرویس");
    await d.pick("استریم");
    await d.pick("Netflix");
    await d.send("SUBMIT", "1");
    expect(d.last.state).toBe("intl.amount");
    expect(d.last.tone).toBe("error");
    await d.send("SUBMIT", "1000");
    expect(d.last.state).toBe("intl.amount");
    await d.send("SUBMIT", "abc");
    expect(d.last.state).toBe("intl.amount");
  });

  it("custom payment collects title, link, amount, currency and description, and files a ticket on the order", async () => {
    const d = await startDriver();
    d.fake.state.userId = "user-1";
    await d.pick("🌍 پرداخت یک سرویس");
    await d.pick("سرویس موردنظر من در لیست نیست");
    await d.pick("USD");
    await d.send("SUBMIT", "اشتراک ابزار طراحی");
    await d.send("SUBMIT", "ftp://bad");
    expect(d.last.state).toBe("custom.link");
    await d.send("SUBMIT", "https://tool.example/pricing");
    await d.send("SUBMIT", "30.5");
    await d.send("SUBMIT", "پلن سالانه");
    expect(d.last.message).toBe("ایمیل حساب");
    await d.send("SUBMIT", "me@example.com");
    expect(hasQuote(d)).toBe(true);
    await d.pick("✅ تأیید و پرداخت");
    const ticket = d.fake.calls.find((c) => c.name === "ticket")?.arg as { orderId: string; message: string };
    expect(ticket.orderId).toBe("o-1");
    expect(ticket.message).toContain("https://tool.example/pricing");
    expect(ticket.message).toContain("پلن سالانه");
    expect(d.fake.count("ticket")).toBe(1);
  });
});

describe("orders", () => {
  it("asks an anonymous visitor to log in first", async () => {
    const d = await startDriver();
    await d.pick("📦 سفارش‌های من");
    expect(d.last.state).toBe("auth.required");
    d.fake.state.userId = "user-1";
    await d.send("RESUME");
    expect(d.last.state).toBe("orders.list");
  });

  it("lists orders, shows the detail, and opens support with the order attached", async () => {
    const d = await startDriver();
    d.fake.state.userId = "user-1";
    await d.pick("📦 سفارش‌های من");
    expect(d.has("سفارش BP-1")).toBe(true);
    await d.pick("سفارش BP-1");
    expect(d.last.state).toBe("orders.detail");
    expect(d.last.options.map((o) => o.label)).toEqual(["مشاهده جزئیات", "پشتیبانی این سفارش"]);
    expect(d.last.navigation.back).toBe(true);
    await d.pick("مشاهده جزئیات");
    expect(d.last.effect).toEqual({ type: "navigate", path: "/orders/BP-1" });
    await d.pick("پشتیبانی این سفارش");
    await d.send("SUBMIT", "مشکل در سفارش");
    await d.send("SUBMIT", "کد نرسیده است");
    expect(d.last.state).toBe("ticket.done");
    expect(d.fake.calls.find((c) => c.name === "ticket")?.arg).toMatchObject({ orderId: "o-1", subject: "مشکل در سفارش" });
  });

  it("success card links to the order that was just paid", async () => {
    const d = await startDriver();
    d.fake.state.userId = "user-1";
    await d.giftCardToQuote();
    await d.pick("✅ تأیید و پرداخت");
    await d.send("RESUME");
    await d.pick("مشاهده سفارش");
    expect(d.last.state).toBe("orders.detail");
  });
});

describe("support", () => {
  it("offers phone, ticket and order tracking from the configured channels", async () => {
    const d = await startDriver();
    await d.pick("☎️ ارتباط با ما");
    expect(d.last.options.map((o) => o.label)).toEqual(["تماس تلفنی", "✉️ ثبت تیکت پشتیبانی", "📦 پیگیری سفارش"]);
    expect(d.last.options[0]?.href).toBe("tel:+98210000");
  });

  it("requires login before a ticket and validates its fields", async () => {
    const d = await startDriver();
    await d.pick("☎️ ارتباط با ما");
    await d.pick("✉️ ثبت تیکت پشتیبانی");
    expect(d.last.state).toBe("auth.required");
    d.fake.state.userId = "user-1";
    await d.send("RESUME");
    expect(d.last.state).toBe("ticket.subject");
    await d.send("SUBMIT", "ab");
    expect(d.last.state).toBe("ticket.subject");
    await d.send("SUBMIT", "سوال درباره قیمت");
    await d.send("SUBMIT", "سلام، قیمت‌ها چطور محاسبه می‌شه؟");
    expect(d.last.state).toBe("ticket.done");
    expect(d.last.message).toContain("T-1");
  });
});

describe("persistence", () => {
  it("a second engine on the same store resumes the same conversation", async () => {
    const fake = createFake();
    const store = createMemoryStore();
    const a = createEngine({ services: fake.services, store });
    await a.handle({ sessionId: "p", action: "RESUME", identity: { channel: "web", channelUserId: "u" } });
    await a.handle({ sessionId: "p", action: "SELECT", value: "giftCard"});
    const b = createEngine({ services: fake.services, store });
    const seen = await b.peek("p");
    expect(seen?.response.state).toBe("gc.search");
    expect(seen?.transcript.length).toBeGreaterThan(0);
  });

  it("stored responses never carry a one-shot effect", async () => {
    const d = await startDriver();
    d.fake.state.userId = "user-1";
    await d.giftCardToQuote();
    await d.pick("✅ تأیید و پرداخت");
    expect(d.last.effect?.type).toBe("redirect");
    const seen = await d.engine.peek("s1");
    expect(seen?.response.effect).toBeUndefined();
  });

  it("never stores anything that looks like a secret", async () => {
    const d = await startDriver();
    await d.pick("🎮 تاپ‌آپ بازی");
    await d.send("SEARCH", "pubg");
    await d.pick("PUBG Mobile");
    await d.pick("۶۰ UC");
    await d.send("SUBMIT", "12345");
    const raw = JSON.stringify(await d.store.get("s1"));
    expect(raw).not.toMatch(/password|otp|token/iu);
  });
});
