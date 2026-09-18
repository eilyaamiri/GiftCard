import { defineConfig, devices } from '@playwright/test';

/** Browser contract tests run against an already-started API + storefront. */
export default defineConfig({
  testDir: './',
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 2 : 0,
  workers: 1,
  reporter: process.env['CI'] ? [['line'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env['WEB_BASE_URL'] ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'fa-IR',
    ...devices['Desktop Chrome'],
  },
  webServer:
    process.env['E2E_START_WEB'] === 'true'
      ? [
          {
            command: 'node mock-api.mjs',
            url: 'http://127.0.0.1:4001/health',
            reuseExistingServer: false,
          },
          {
            command: 'API_INTERNAL_URL=http://127.0.0.1:4001 pnpm --filter @barat/web dev',
            url: 'http://localhost:3000',
            reuseExistingServer: false,
          },
        ]
      : undefined,
});
