import { test, expect } from '@playwright/test';

test('service content and images follow the original request form without changing its payload', async ({ page }) => {
  await page.goto('/services/chatgpt-s0004');
  const form = page.locator('.service-detail-page > form');
  const article = page.getByRole('article');
  await expect(article).toContainText('برات');
  await expect(article).not.toContainText(/پرداخت[\s\u200c]*پرو|IMG\d+/u);
  await expect(article.getByRole('img').first()).toBeVisible();
  await expect.poll(() => article.getByRole('img').first().evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  expect(await article.evaluate((node) => node.previousElementSibling?.tagName)).toBe('FORM');
  await expect(form.locator('input')).toHaveCount(5);
  await page.getByLabel('مبلغ به USD').fill('25');
  await page.getByLabel('آدرس سایتی که باید پرداخت شود').fill('https://example.test/invoice');
  await page.getByLabel('شماره فاکتور').fill('INV-CONTENT-TEST');
  const request = page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/api/quotes'));
  await form.getByRole('button', { name: 'دریافت قیمت' }).click();
  expect((await request).postDataJSON()).toMatchObject({ serviceId: 'content_service_s0004', quantity: 1, currency: 'USD', requestedAmountForeign: '25', serviceFields: { siteUrl: 'https://example.test/invoice', invoiceNumber: 'INV-CONTENT-TEST' } });
  await expect(page).toHaveURL(/\/quote\/quote-e2e-001$/u);
});

test('late-page services remain visible and searchable on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/services?q=تلگرام');
  await expect(page.getByRole('link', { name: /خرید تلگرام پرمیوم/u })).toBeVisible();
  await page.getByRole('link', { name: /خرید تلگرام پرمیوم/u }).click();
  await expect(page.getByRole('article')).toContainText('تلگرام');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
