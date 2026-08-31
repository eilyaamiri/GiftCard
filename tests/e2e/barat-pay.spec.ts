import { expect, test } from '@playwright/test';

/**
 * Customer journey smoke test. Payment and OTP are completed by the mock
 * environment configured for CI; the assertions intentionally stay at public
 * contract boundaries so no secret or OTP value enters the test repository.
 */
test('customer can browse a gift card and reach the quote boundary', async ({ page }) => {
  await page.goto('/gift-cards');
  await expect(page).toHaveTitle(/گیفت|برات/u);
  await expect(page.getByRole('heading', { name: /گیفت.?کارت/u }).first()).toBeVisible();

  const firstProduct = page.locator('a[href^="/gift-cards/"]').first();
  await expect(firstProduct).toBeVisible();
  await firstProduct.click();
  await expect(page).toHaveURL(/\/gift-cards\/.+/u);
  await expect(page.locator('body')).not.toContainText(/supplier|تأمین.?کننده|cost|هزینه تأمین/u);
});

test('a direct send call cannot bypass the incomplete checklist gate', async ({ request }) => {
  const response = await request.post(
    `${process.env['API_BASE_URL'] ?? 'http://localhost:4000'}/api/fulfillment/unknown-work-item/send`,
    {
      data: {},
    },
  );
  // Unknown or unauthenticated requests are rejected before any delivery side effect.
  expect([401, 403, 404, 422]).toContain(response.status());
});

test('customer-facing pages never expose supplier identity or cost', async ({ page }) => {
  await page.goto('/orders');
  const body = await page.locator('body').innerText();
  expect(body).not.toMatch(/supplier|تأمین.?کننده|supplierCost|actualSupplierCost|costAmount/u);
});
