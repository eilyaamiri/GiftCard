import { expect, test } from "@playwright/test";

test("customer can navigate the public storefront", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /چیزی که در جهان می.?خواهید/i })).toBeVisible();
  await page.getByRole("navigation", { name: "منوی اصلی" }).getByRole("link", { name: "گیفت‌کارت‌ها" }).click();
  await expect(page).toHaveURL(/\/gift-cards$/u);
  await expect(page.getByRole("heading", { name: "گیفت‌کارت‌ها", level: 1 })).toBeVisible();
});

test.describe("catalog taxonomy", () => {
  test("customer can search the gift-card catalog", async ({ page }) => {
    await page.goto("/gift-cards");

    const search = page.getByRole("searchbox", { name: "جست‌وجو در گیفت‌کارت‌ها" });
    await search.fill("استیم");
    await search.press("Enter");

    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("استیم");
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /گیفت‌کارت اپل/i })).toHaveCount(0);
  });

  test("customer can narrow the catalog by category, then by region", async ({ page }) => {
    await page.goto("/gift-cards");

    await page.getByRole("complementary").getByRole("link", { name: /بازی و گیم/u }).click();
    await expect(page).toHaveURL(/[?&]category=gaming/u);
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /گیفت‌کارت اپل/i })).toHaveCount(0);

    await page.getByRole("link", { name: "پاک کردن فیلترها" }).click();
    await expect(page).toHaveURL(/\/gift-cards$/u);

    await page.getByLabel("منطقهٔ گیفت‌کارت").selectOption("UK");
    await page.getByRole("button", { name: "اعمال" }).click();
    await expect(page).toHaveURL(/[?&]region=UK/u);
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /گیفت‌کارت اپل/i })).toHaveCount(0);
  });

  test("customer can narrow the catalog by brand", async ({ page }) => {
    await page.goto("/gift-cards");

    await page.getByRole("complementary").getByRole("link", { name: /اپل/u }).click();
    await expect(page).toHaveURL(/[?&]brand=apple/u);
    await expect(page.getByRole("link", { name: /گیفت‌کارت اپل/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toHaveCount(0);
  });

  test("a product still missing data is listed but cannot be bought", async ({ page }) => {
    await page.goto("/gift-cards");

    const spotifyCard = page.locator(".catalog-card-off", { hasText: "گیفت‌کارت اسپاتیفای" });
    await expect(spotifyCard).toBeVisible();
    await expect(spotifyCard.getByText("فعلاً قابل سفارش نیست")).toBeVisible();
    await expect(page.getByRole("link", { name: /گیفت‌کارت اسپاتیفای/i })).toHaveCount(0);
  });

  test("customer can browse brands from the directory and land back in the catalog", async ({ page }) => {
    await page.goto("/brands");

    await expect(page.getByRole("heading", { name: "برندها", level: 1 })).toBeVisible();
    await page.getByRole("link", { name: /استیم/u }).first().click();
    await expect(page).toHaveURL(/[?&]brand=steam/u);
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
  });

  test("a card always shows the generated artwork, even when the supplier sent a photo", async ({ page }) => {
    await page.goto("/gift-cards");

    const appleCard = page.getByRole("link", { name: /گیفت‌کارت اپل/i });
    await expect(appleCard.getByRole("img", { name: "تصویر گیفت‌کارت اپل" })).toBeVisible();
    await expect(appleCard.locator("img")).toHaveCount(0);
  });

  test("a region picked in the catalog is carried into the product page", async ({ page }) => {
    await page.goto("/gift-cards?region=UK");

    await page.getByRole("link", { name: /گیفت‌کارت استیم/i }).click();
    await expect(page).toHaveURL(/\/gift-cards\/steam-wallet\?region=UK$/u);
    await expect(
      page.getByRole("radiogroup", { name: "انتخاب منطقه" }).getByRole("radio", { name: "UK" }),
    ).toBeChecked();
  });
});

test.describe("catalog browsing on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true });

  test("the drawer opens over the page, without disturbing the bottom navigation", async ({ page }) => {
    await page.goto("/gift-cards");

    await expect(page.getByRole("navigation", { name: "منوی موبایل" })).toBeVisible();
    await page.getByRole("button", { name: /دسته‌بندی‌ها/u }).click();

    const drawer = page.getByRole("dialog", { name: "دسته‌بندی‌ها" });
    await expect(drawer).toBeVisible();
    await expect(page.getByRole("navigation", { name: "منوی موبایل" })).toBeVisible();

    await drawer.getByRole("link", { name: /بازی و گیم/u }).click();
    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/[?&]category=gaming/u);
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("closes on Escape without applying a filter", async ({ page }) => {
    await page.goto("/gift-cards");

    await page.getByRole("button", { name: /برندها/u }).click();
    await expect(page.getByRole("dialog", { name: "برندها" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "برندها" })).toBeHidden();
    await expect(page).toHaveURL(/\/gift-cards$/u);
  });
});

test("customer can obtain a gift-card quote after choosing region and amount", async ({ page }) => {
  await page.goto("/gift-cards/steam-wallet");

  await page.getByRole("radiogroup", { name: "انتخاب منطقه" }).getByRole("radio", { name: "UK" }).click();
  await expect(page.getByRole("radiogroup", { name: "انتخاب مبلغ" }).getByRole("radio", { name: "£20" })).toBeChecked();
  await page.getByRole("button", { name: "دریافت قیمت نهایی" }).click();

  await expect(page).toHaveURL(/\/quote\/quote-e2e-001$/u);
  await expect(page.getByText("Q-E2E-001")).toBeVisible();
  await expect(page.getByText("مبلغ قابل پرداخت")).toBeVisible();
});

test("customer can submit a complete service-payment request", async ({ page }) => {
  await page.goto("/services/hosting-payment");

  await page.getByLabel("مبلغ به USD").fill("25");
  await page.getByLabel("آدرس سایتی که باید پرداخت شود").fill("https://example.test/invoice");
  await page.getByLabel("شماره فاکتور").fill("INV-E2E-001");
  await page.getByRole("button", { name: "دریافت قیمت" }).click();

  await expect(page).toHaveURL(/\/quote\/quote-e2e-001$/u);
  await expect(page.getByText("مبلغ قابل پرداخت")).toBeVisible();
});

test("public customer pages never expose supplier identity or cost", async ({ page }) => {
  for (const path of ["/", "/gift-cards", "/gift-cards/steam-wallet", "/services/hosting-payment", "/quote/quote-e2e-001"]) {
    await page.goto(path);
    await expect(page.locator("body")).not.toContainText(/supplier|تأمین.?کننده|supplierCost|actualSupplierCost|costAmount/u);
  }
});

test.describe("payment window on the pro-forma invoice", () => {
  /* The storefront forwards whatever cookies the browser holds, so a session
   * cookie is all the mock API needs to answer as a signed-in customer. */
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "barat_session", value: "e2e", domain: "localhost", path: "/" }]);
  });

  test("shows how long is left to pay, next to the way out", async ({ page }) => {
    await page.goto("/checkout/BP-2026-000001");

    await expect(page.getByText("مهلت پرداخت این سفارش")).toBeVisible();
    await expect(page.getByRole("timer")).toBeVisible();
    await expect(page.getByRole("button", { name: "لغو سفارش" })).toBeVisible();
  });

  test("cancelling asks once, warns the price is not held, then closes the order", async ({ page }) => {
    await page.goto("/checkout/BP-2026-000002");

    /* One click must not cancel: it only turns the link into a question. */
    await page.getByRole("button", { name: "لغو سفارش" }).click();
    await expect(page.getByText(/برای خرید دوباره باید پیش.?فاکتور جدید بگیرید/u)).toBeVisible();
    await expect(page.getByRole("timer")).toBeVisible();

    await page.getByRole("button", { name: "بله، سفارش را لغو کن" }).click();

    await expect(page.getByText("لغو شد", { exact: true })).toBeVisible();
    /* Nothing is left to pay or to cancel — only a route back to a fresh price. */
    await expect(page.getByRole("button", { name: "لغو سفارش" })).toHaveCount(0);
    await expect(page.getByRole("timer")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "گرفتن پیش‌فاکتور جدید" })).toBeVisible();
  });

  test("backing out of the confirmation leaves the order payable", async ({ page }) => {
    await page.goto("/checkout/BP-2026-000001");

    await page.getByRole("button", { name: "لغو سفارش" }).click();
    await page.getByRole("button", { name: "پشیمان شدم" }).click();

    await expect(page.getByRole("button", { name: "بله، سفارش را لغو کن" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "لغو سفارش" })).toBeVisible();
  });
});

test.describe("mobile bottom navigation", () => {
  /* 320px is the narrowest phone the storefront supports; the bar has to hold
   * four tabs there without pushing the page sideways. */
  test.use({ viewport: { width: 320, height: 720 }, isMobile: true });

  test("offers exactly the four tabs, and never the desktop nav", async ({ page }) => {
    await page.goto("/");

    const bar = page.getByRole("navigation", { name: "منوی موبایل" });
    await expect(bar).toBeVisible();
    await expect(bar.getByRole("link", { name: "خانه" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "سفارش‌ها" })).toBeVisible();
    await expect(bar.getByRole("button", { name: "تماس با ما" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "حساب کاربری" })).toBeVisible();
    await expect(bar.getByRole("link", { name: "گیفت‌کارت‌ها" })).toHaveCount(0);
    await expect(bar.getByRole("link", { name: "پرداخت بین‌المللی" })).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "منوی اصلی" })).toBeHidden();

    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("marks the page you are on, in the brand turquoise", async ({ page }) => {
    await page.goto("/");

    const home = page.getByRole("navigation", { name: "منوی موبایل" }).getByRole("link", { name: "خانه" });
    await expect(home).toHaveAttribute("aria-current", "page");
    /* var(--teal) — #21B4B0. The active tab must not rely on the icon alone. */
    await expect(home).toHaveCSS("color", "rgb(33, 180, 176)");
  });

  test("sends a signed-out visitor to login, and back again afterwards", async ({ page }) => {
    await page.goto("/");

    const bar = page.getByRole("navigation", { name: "منوی موبایل" });
    await expect(bar.getByRole("link", { name: "سفارش‌ها" })).toHaveAttribute("href", "/login?next=%2Forders");
    await expect(bar.getByRole("link", { name: "حساب کاربری" })).toHaveAttribute("href", "/login?next=%2Faccount");
  });

  test("never covers the end of the page", async ({ page }) => {
    await page.goto("/gift-cards");

    const clearance = await page.evaluate(() => {
      const bar = document.querySelector(".bottom-nav");
      const main = document.querySelector(".page");
      if (bar === null || main === null) return null;
      return {
        barHeight: bar.getBoundingClientRect().height,
        padding: Number.parseFloat(getComputedStyle(main).paddingBottom),
      };
    });
    expect(clearance).not.toBeNull();
    expect(clearance!.padding).toBeGreaterThanOrEqual(clearance!.barHeight);
  });

  test("the contact sheet opens, lists only live channels, and closes three ways", async ({ page }) => {
    await page.goto("/");

    const bar = page.getByRole("navigation", { name: "منوی موبایل" });
    const sheet = page.getByRole("dialog", { name: "تماس با ما" });
    const openSheet = async () => {
      await bar.getByRole("button", { name: "تماس با ما" }).click();
      await expect(sheet).toBeVisible();
    };

    await openSheet();
    await expect(sheet.getByRole("link", { name: /تماس تلفنی/u })).toHaveAttribute("href", "tel:02191001234");
    const telegram = sheet.getByRole("link", { name: /تلگرام/u });
    await expect(telegram).toHaveAttribute("href", "https://t.me/baratpay");
    /* Anything that leaves the site opens detached from this page. */
    await expect(telegram).toHaveAttribute("target", "_blank");
    await expect(telegram).toHaveAttribute("rel", /noopener/u);
    await expect(sheet.getByRole("link", { name: /واتساپ/u })).toHaveAttribute("href", "https://wa.me/989121234567");
    /* Signed out, the ticket link carries the way back to where it was going. */
    await expect(sheet.getByRole("link", { name: /ثبت تیکت/u })).toHaveAttribute(
      "href",
      "/login?next=%2Faccount%2Fsupport",
    );

    await sheet.getByRole("button", { name: "بستن" }).click();
    await expect(sheet).toBeHidden();

    await openSheet();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    await openSheet();
    /* A click on the backdrop lands on the dialog element itself. */
    await page.mouse.click(10, 10);
    await expect(sheet).toBeHidden();
  });

  test("stays inside the viewport at the top of the mobile range", async ({ page }) => {
    await page.setViewportSize({ width: 767, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("navigation", { name: "منوی موبایل" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});

test.describe("mobile navigation drawer", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true });

  test("collapses the header search and nav behind a top-right trigger", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner").getByRole("searchbox", { name: "جست‌وجوی گیفت‌کارت یا برند" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "منوی اصلی" })).toBeHidden();

    const trigger = page.getByRole("button", { name: "باز کردن منو" });
    await expect(trigger).toBeVisible();
    await trigger.click();

    const drawer = page.getByRole("dialog", { name: "منوی ناوبری" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole("searchbox", { name: "جست‌وجوی گیفت‌کارت یا برند" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "گیفت‌کارت‌ها" })).toBeVisible();
    await expect(drawer.getByRole("link", { name: "پرداخت بین‌المللی" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("the search field sends a customer straight into a filtered catalog", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "باز کردن منو" }).click();
    const drawer = page.getByRole("dialog", { name: "منوی ناوبری" });
    await drawer.getByRole("searchbox", { name: "جست‌وجوی گیفت‌کارت یا برند" }).fill("استیم");
    await drawer.getByRole("button", { name: "جست‌وجو" }).click();

    await expect(page).toHaveURL(/\/gift-cards\?q=/u);
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("استیم");
    await expect(drawer).toBeHidden();
  });

  test("categories and brands expand as accordions and land in the filtered catalog", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("button", { name: "باز کردن منو" }).click();
    const drawer = page.getByRole("dialog", { name: "منوی ناوبری" });

    const categoriesGroup = drawer.locator(".mobile-nav-drawer-group", { hasText: "دسته‌بندی‌ها" });
    await expect(categoriesGroup.getByRole("link", { name: /بازی و گیم/u })).toBeHidden();
    await categoriesGroup.locator("summary").click();
    await categoriesGroup.getByRole("link", { name: /بازی و گیم/u }).click();

    await expect(drawer).toBeHidden();
    await expect(page).toHaveURL(/[?&]category=gaming/u);
  });

  test("closes on Escape, on the backdrop, and via the close button", async ({ page }) => {
    await page.goto("/");

    const drawer = page.getByRole("dialog", { name: "منوی ناوبری" });
    const openDrawer = async () => {
      await page.getByRole("button", { name: "باز کردن منو" }).click();
      await expect(drawer).toBeVisible();
    };

    await openDrawer();
    await drawer.getByRole("button", { name: "بستن منو" }).click();
    await expect(drawer).toBeHidden();

    await openDrawer();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();

    await openDrawer();
    /* A click on the backdrop lands on the dialog element itself. */
    await page.mouse.click(10, 10);
    await expect(drawer).toBeHidden();
  });

  test("disappears at 768px, where the desktop header nav takes over", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "باز کردن منو" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "منوی اصلی" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});

test.describe("tablet and desktop navigation", () => {
  test("the bottom bar is gone at 768px, and the header nav is back", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/");

    await expect(page.getByRole("navigation", { name: "منوی موبایل" })).toBeHidden();
    await expect(page.getByRole("navigation", { name: "منوی اصلی" })).toBeVisible();
  });

  test("desktop keeps the header nav it always had", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "منوی اصلی" });
    await expect(nav.getByRole("link", { name: "گیفت‌کارت‌ها" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "پرداخت بین‌المللی" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "منوی موبایل" })).toBeHidden();
  });

  test("the header's support button opens the same sheet, and closes two ways", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const button = page.getByRole("button", { name: "تماس با ما" });
    const sheet = page.getByRole("dialog", { name: "تماس با ما" });
    await expect(button).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.click();
    await expect(sheet).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    /* The same four rows the phone bar shows, from the same published list. */
    await expect(sheet.getByRole("link", { name: /تماس تلفنی/u })).toHaveAttribute("href", "tel:02191001234");
    await expect(sheet.getByRole("link", { name: /تلگرام/u })).toHaveAttribute("href", "https://t.me/baratpay");

    await sheet.getByRole("button", { name: "بستن" }).click();
    await expect(sheet).toBeHidden();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    await button.click();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("the support button is a desktop affordance only", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto("/");

    /* The bar's own tab is the phone entry point, so the header must not offer
     * a second one — the bar's button is a different element inside the nav. */
    await expect(page.locator(".header-support")).toBeHidden();
    await expect(
      page.getByRole("navigation", { name: "منوی موبایل" }).getByRole("button", { name: "تماس با ما" }),
    ).toBeVisible();
  });

  test("the footer prints the published phone number and dials it", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const phone = page.locator(".footer-phone");
    await expect(phone).toHaveAttribute("href", "tel:02191001234");
    await expect(phone).toContainText("02191001234");
    /* The hours an admin typed travel with the number. */
    await expect(phone).toContainText("شنبه تا چهارشنبه، ۹ تا ۱۷");
  });

  test("the header search bar sends a customer straight into a filtered catalog", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const search = page.getByRole("banner").getByRole("searchbox", { name: "جست‌وجوی گیفت‌کارت یا برند" });
    await search.fill("استیم");
    await search.press("Enter");

    await expect(page).toHaveURL(/\/gift-cards\?q=/u);
    await expect.poll(() => new URL(page.url()).searchParams.get("q")).toBe("استیم");
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
  });

  test("the header's category dropdown opens a menu and lands in the filtered catalog", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "منوی اصلی" });
    const trigger = nav.getByRole("button", { name: "دسته‌بندی‌ها" });
    await expect(trigger).toHaveAttribute("aria-expanded", "false");

    await trigger.click();
    const menu = nav.getByRole("menu");
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(menu.getByRole("menuitem", { name: /بازی و گیم/u })).toBeVisible();

    await menu.getByRole("menuitem", { name: /بازی و گیم/u }).click();
    await expect(page).toHaveURL(/\/gift-cards\?category=gaming$/u);
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
  });

  test("the header's brand dropdown opens a menu and lands in the filtered catalog", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "منوی اصلی" });
    await nav.getByRole("button", { name: "برندها" }).click();
    const menu = nav.getByRole("menu");
    await menu.getByRole("menuitem", { name: /استیم/u }).click();

    await expect(page).toHaveURL(/\/gift-cards\?brand=steam$/u);
    await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
  });

  test("a dropdown menu's column count tracks its own item count, and no label is clipped", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "منوی اصلی" });

    async function checkMenu(triggerName: string) {
      await nav.getByRole("button", { name: triggerName }).click();
      const menu = page.locator(".nav-dropdown-menu");
      await expect(menu).toBeVisible();
      const result = await menu.evaluate((el) => {
        const itemCount = el.querySelectorAll("li[role=none]").length;
        const expectedCols = Math.min(3, Math.max(1, Math.ceil(itemCount / 8)));
        const actualCols = Number(getComputedStyle(el).getPropertyValue("--nav-dropdown-cols").trim());
        const clipped = [...el.querySelectorAll(".nav-dropdown-item-label")].some(
          (label) => label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1,
        );
        return { itemCount, expectedCols, actualCols, clipped };
      });
      await page.keyboard.press("Escape");
      return result;
    }

    const categories = await checkMenu("دسته‌بندی‌ها");
    expect(categories.clipped).toBe(false);
    expect(categories.actualCols).toBe(categories.expectedCols);

    const brands = await checkMenu("برندها");
    expect(brands.clipped).toBe(false);
    expect(brands.actualCols).toBe(brands.expectedCols);
  });

  test("a header dropdown closes on Escape and on an outside click", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "منوی اصلی" });
    const trigger = nav.getByRole("button", { name: "دسته‌بندی‌ها" });

    await trigger.click();
    await expect(nav.getByRole("menu")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nav.getByRole("menu")).toBeHidden();

    await trigger.click();
    await expect(nav.getByRole("menu")).toBeVisible();
    await page.mouse.click(10, 10);
    await expect(nav.getByRole("menu")).toBeHidden();
  });

  test("order tracking and help moved out of the header, into the footer sitemap", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const nav = page.getByRole("navigation", { name: "منوی اصلی" });
    await expect(nav.getByRole("link", { name: "پیگیری سفارش" })).toHaveCount(0);
    await expect(nav.getByRole("link", { name: "راهنما" })).toHaveCount(0);

    const sitemap = page.getByRole("navigation", { name: "نقشه سایت" });
    await expect(sitemap.getByRole("link", { name: "پیگیری سفارش" })).toHaveAttribute("href", "/orders");
    await expect(sitemap.getByRole("link", { name: "راهنما" })).toHaveAttribute("href", "/help");
  });

  test("the footer sitemap lists every live section, stacked vertically", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    const sitemap = page.getByRole("navigation", { name: "نقشه سایت" });
    await expect(sitemap.getByRole("link", { name: "گیفت‌کارت‌ها" })).toHaveAttribute("href", "/gift-cards");
    await expect(sitemap.getByRole("link", { name: "پرداخت بین‌المللی" })).toHaveAttribute("href", "/services");
    await expect(sitemap.getByRole("link", { name: "برندها" })).toHaveAttribute("href", "/brands");
    /* No session cookie is set, so the sitemap's account link points at login, not the panel. */
    await expect(sitemap.getByRole("link", { name: "ورود" })).toHaveAttribute("href", "/login");

    const flexDirection = await sitemap.evaluate((element) => getComputedStyle(element).flexDirection);
    expect(flexDirection).toBe("column");
  });
});

test("the homepage offers a row of category tiles below the hero", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const tile = page.getByRole("link", { name: "بازی و گیم" });
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page).toHaveURL(/\/gift-cards\?category=gaming$/u);
});

test.describe("homepage featured strip", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("shows only orderable «عمومی و پرکاربرد» products, quick pick first, between the category tiles and the three-step section", async ({ page }) => {
    await page.goto("/");

    const featured = page.locator("section", { has: page.getByRole("heading", { name: "شروع‌های مطمئن" }) });
    await expect(featured.getByRole("link", { name: /گیفت‌کارت گوگل‌پلی/i })).toBeVisible();
    await expect(featured.getByRole("link", { name: /گیفت‌کارت آمازون/i })).toBeVisible();
    // Still missing data, and from other categories — neither belongs on the strip.
    await expect(featured.getByRole("link", { name: /گیفت‌کارت آیتیونز/i })).toHaveCount(0);
    await expect(featured.getByRole("link", { name: /گیفت‌کارت استیم/i })).toHaveCount(0);
    await expect(featured.getByRole("link", { name: /گیفت‌کارت اپل/i })).toHaveCount(0);

    const cards = featured.locator(".product-grid").getByRole("link");
    await expect(cards.nth(0)).toContainText("گوگل‌پلی");
    await expect(cards.nth(1)).toContainText("آمازون");

    const sectionHeadings = await page.locator("main > section h2").allTextContents();
    expect(sectionHeadings).toEqual(["شروع‌های مطمئن", "سه قدم تا مقصد"]);
  });

  test("puts the three value cards last, right before the footer", async ({ page }) => {
    await page.goto("/");

    const lastSection = page.locator("main > section").last();
    await expect(lastSection.locator(".value-grid")).toBeVisible();
    await expect(lastSection.getByRole("heading", { name: "قیمت، قبل از تصمیم" })).toBeVisible();
    await expect(lastSection.getByRole("heading", { name: "پیگیری تا پایان" })).toBeVisible();
  });
});

test.describe("mobile header brand mark", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true });

  test("shows only the logo mark up top; the wordmark moves next to the drawer trigger", async ({ page }) => {
    await page.goto("/");

    const logo = page.getByRole("link", { name: "برات، صفحه اصلی" });
    await expect(logo).toBeVisible();
    await expect(logo.locator(".logo-word")).toBeHidden();

    const wordmark = page.locator(".mobile-brand-word");
    await expect(wordmark).toBeVisible();
    await expect(wordmark).toHaveText("برات");
  });
});

test.describe("desktop header brand mark", () => {
  test("keeps the full wordmark next to the icon, and hides the mobile grouping", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/");

    await expect(page.getByRole("link", { name: "برات، صفحه اصلی" }).locator(".logo-word")).toBeVisible();
    await expect(page.locator(".mobile-brand-word")).toBeHidden();
  });
});

test.describe("mobile RTL storefront", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true });

  test("keeps catalog usable without horizontal overflow", async ({ page }) => {
    await page.goto("/gift-cards");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "گیفت‌کارت‌ها", level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("a signed-out visitor can still reach login from the header", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner").getByRole("link", { name: "ورود" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});
