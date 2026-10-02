import { describe, expect, it } from "vitest";
import { startDriver, type Driver } from "../testing/driver";

const quoteCard = (d: Driver) => d.last.blocks.find((b) => b.kind === "quote");

async function signedInQuote(): Promise<Driver> {
  const d = await startDriver();
  d.fake.state.userId = "user-1";
  await d.giftCardToQuote();
  return d;
}

describe("login gate", () => {
  it("asks to sign in, keeps the cart, and resumes at a refreshed quote", async () => {
    const d = await startDriver();
    await d.giftCardToQuote();
    const first = d.fake.count("quote");
    await d.pick("✅ تأیید و پرداخت");
    expect(d.last.state).toBe("auth.required");
    expect(d.last.message).toBe("برای ثبت سفارش لازمه وارد حساب کاربریتون بشید.");
    expect(d.fake.count("placeOrder")).toBe(0);

    await d.pick("ورود با کد یکبار مصرف");
    expect(d.last.effect).toEqual({ type: "login" });

    d.fake.state.userId = "user-1";
    await d.send("RESUME");
    expect(d.last.state).toBe("checkout.confirm");
    expect(d.fake.count("quote")).toBe(first + 1);
    expect(d.last.blocks.some((b) => b.kind === "quote")).toBe(true);
    expect(d.fake.count("placeOrder")).toBe(0);
  });

  it("still shows the login gate when the person has not signed in yet", async () => {
    const d = await startDriver();
    await d.giftCardToQuote();
    await d.pick("✅ تأیید و پرداخت");
    await d.send("RESUME");
    expect(d.last.state).toBe("auth.required");
  });
});

describe("payment", () => {
  it("success: one order, redirect to the gateway, then the success card after server verification", async () => {
    const d = await signedInQuote();
    await d.pick("✅ تأیید و پرداخت");
    expect(d.last.effect).toEqual({ type: "redirect", url: "https://gateway.test/pay" });
    expect(d.fake.count("placeOrder")).toBe(1);

    await d.send("RESUME");
    expect(d.last.state).toBe("checkout.success");
    expect(d.last.message).toBe("پرداخت با موفقیت انجام شد 🎉 سفارش شما ثبت شد.");
    expect(d.last.options.map((o) => o.label)).toEqual(["مشاهده سفارش", "سفارش‌های من", "خرید جدید", "⌂ منوی اصلی"]);
    expect(d.fake.events).toEqual(expect.arrayContaining(["order_confirmed", "order_created", "payment_started", "payment_succeeded"]));
  });

  it("a second confirm cannot create a second order", async () => {
    const d = await signedInQuote();
    const confirm = d.last.options.find((o) => o.action === "CONFIRM");
    expect(confirm).toBeDefined();
    const [a, b] = await Promise.all([d.engine.handle({ sessionId: "s1", action: "CONFIRM" }), d.engine.handle({ sessionId: "s1", action: "CONFIRM" })]);
    expect(a.state).toBe("checkout.awaiting");
    expect(b.tone).toBe("error");
    expect(d.fake.count("placeOrder")).toBe(1);
    expect(d.fake.count("startPayment")).toBe(1);
  });

  it("failure: shows the failure card; retry renews the payment without a new order", async () => {
    const d = await signedInQuote();
    await d.pick("✅ تأیید و پرداخت");
    d.fake.state.outcome = "FAILED";
    await d.send("RESUME");
    expect(d.last.state).toBe("checkout.failed");
    expect(d.last.message).toBe("پرداخت تکمیل نشد.");
    expect(d.last.options.map((o) => o.label)).toEqual(["تلاش مجدد", "مشاهده سفارش", "← بازگشت", "⌂ منوی اصلی"]);

    d.fake.state.outcome = "PAID";
    await d.pick("تلاش مجدد");
    expect(d.fake.count("placeOrder")).toBe(1);
    const starts = d.fake.calls.filter((c) => c.name === "startPayment");
    expect(starts).toHaveLength(2);
    expect(starts[1]?.arg).toMatchObject({ renew: true });
    await d.send("RESUME");
    expect(d.last.state).toBe("checkout.success");
  });

  it("an undecided payment stays awaiting instead of claiming a result", async () => {
    const d = await signedInQuote();
    await d.pick("✅ تأیید و پرداخت");
    d.fake.state.outcome = "UNKNOWN";
    await d.send("RESUME");
    expect(d.last.state).toBe("checkout.awaiting");
    expect(d.last.message).toContain("هنوز نتیجهٔ پرداخت مشخص نشده.");
  });

  it("a duplicate RESUME after success does not repeat anything", async () => {
    const d = await signedInQuote();
    await d.pick("✅ تأیید و پرداخت");
    await d.send("RESUME");
    await d.send("RESUME");
    expect(d.last.state).toBe("checkout.success");
    expect(d.fake.count("placeOrder")).toBe(1);
  });
});

describe("quote freshness", () => {
  it("replaces an expired quote with a fresh one and asks again", async () => {
    const d = await signedInQuote();
    d.fake.state.now += 11 * 60_000;
    const before = d.fake.count("quote");
    await d.send("CONFIRM");
    expect(d.last.message).toContain("قیمت این سفارش به‌روزرسانی شده.");
    expect(d.last.state).toBe("checkout.confirm");
    expect(d.fake.count("quote")).toBe(before + 1);
    expect(quoteCard(d)).toBeDefined();
    expect(d.fake.count("placeOrder")).toBe(0);
  });

  it("when the server rejects the price at order time, it re-quotes and never charges silently", async () => {
    const d = await signedInQuote();
    d.fake.state.placeRequotes = true;
    const before = d.fake.count("quote");
    await d.pick("✅ تأیید و پرداخت");
    expect(d.last.state).toBe("checkout.confirm");
    expect(d.last.message).toContain("قیمت این سفارش به‌روزرسانی شده.");
    expect(d.fake.count("quote")).toBe(before + 1);
    expect(d.fake.count("startPayment")).toBe(0);
  });
});

describe("product availability", () => {
  it("never offers a region or denomination the catalogue does not list", async () => {
    const d = await startDriver();
    await d.pick("🎁 خرید گیفت کارت");
    await d.send("SEARCH", "itunes");
    await d.pick("iTunes");
    expect(d.last.options.map((o) => o.label).sort()).toEqual(["EU", "US"].sort());
    await d.send("SELECT", "JP");
    expect(d.last.tone).toBe("error");
    expect(d.last.state).toBe("gc.region");
  });
});
