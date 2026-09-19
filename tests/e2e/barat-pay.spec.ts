import { expect, test } from "@playwright/test";

test("customer can navigate the public storefront", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /چیزی که در جهان می.?خواهید/i })).toBeVisible();
  await page.getByRole("link", { name: "گیفت‌کارت‌ها" }).click();
  await expect(page).toHaveURL(/\/gift-cards$/u);
  await expect(page.getByRole("heading", { name: "گیفت‌کارت‌های محبوب" })).toBeVisible();
});

test("customer can search and filter the gift-card catalog", async ({ page }) => {
  await page.goto("/gift-cards");

  const search = page.getByRole("searchbox", { name: "جستجو در گیفت‌کارت‌ها" });
  await search.fill("استیم");
  await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /گیفت‌کارت اپل/i })).toHaveCount(0);

  await search.fill("");
  await page.getByRole("group", { name: "فیلتر منطقه" }).getByRole("button", { name: "UK" }).click();
  await expect(page.getByRole("link", { name: /گیفت‌کارت استیم/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /گیفت‌کارت اپل/i })).toHaveCount(0);
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

test.describe("mobile RTL storefront", () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true });

  test("keeps catalog usable without horizontal overflow", async ({ page }) => {
    await page.goto("/gift-cards");

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByRole("heading", { name: "گیفت‌کارت‌های محبوب" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test("a signed-out visitor can still reach login from the header", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("banner").getByRole("link", { name: "ورود" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});
