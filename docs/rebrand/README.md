# CENTO rebrand

Barat / برات / Barat Pay became **CENTO / سنتو** (`https://centopay.ir`). This is a
name, logo, copy, SEO and route change only — the colour themes, layout, prices,
payment flow and every technical identifier are unchanged.

## Where the brand lives

- `apps/web/src/lib/brand.ts` — name, Persian name, domain, tagline, hero copy,
  SEO title/description, asset paths, the page-title template and the Jalali
  copyright year. Customer-facing code reads from here.
- `apps/web/src/components/brand-logo.tsx` — the logo, with the light- and
  dark-theme files switched by CSS on `data-theme` (no client JS).
- `apps/web/public/brand/cento/` — logos, lockups, symbols, favicons and app
  icons cut from the designer's exports, unmodified apart from cropping. The
  app icon (light and dark tile) and the Persian wordmark «سنتو» (dark and
  white ink) come from the transparent re-exports. They supply the favicons
  (light or dark by `prefers-color-scheme`), the iOS, PWA and maskable icons, the
  OpenGraph image, the assistant avatar and the brand line on the auth panel.
- `apps/admin` — titles; the sidebar and login use the dark app icon and the
  Persian wordmark, with the admin palette kept. Favicons are under
  `apps/admin/public/brand/cento/`. No «س» glyph mark remains anywhere.

## Deliberately not renamed

Renaming these would log customers out, break deploys or change audit history,
for no visible gain:

- `@barat/*` package scopes, `BaratDomainException`, DI tokens `barat.*`.
- Cookies `barat_session`, `barat_staff_session`, `barat_locale`,
  `barat_commerce_session`; storage keys `barat-theme`, `barat.assistant.*`,
  `barat.payment-attempt.*`, `barat.otp.challenge`; events `barat:*`.
- Env keys, Docker users/images (`baratpay`), `/var/lib/baratpay`,
  `/opt/baratpay`, `ops/nginx-baratpay.conf`, deploy scripts.
- Historic migrations and existing orders, payments, audit rows.
- Test-only domains (`barat.test`, `baratpay.example`).

## Data

- Migration `20261003120000_cento_rebrand_kb` rewrites the eight seeded help
  articles and four seeded categories by id, and renames the slug
  `what-is-barat` → `what-is-cento` (old URL redirects, see
  [redirects.md](redirects.md)). Admin-authored articles are not touched.
- `packages/database/prisma/data/catalog-descriptions.json` is updated; existing
  databases pick it up only when an operator re-runs
  `tsx prisma/populate-catalog-descriptions.ts`.

## Manual steps outside the repo

- DNS + TLS for `centopay.ir`; nginx `server_name`; `WEB_PUBLIC_URL` and the
  CORS allowlist; set `NEXT_PUBLIC_SITE_URL=https://centopay.ir` (or leave it
  unset) for the web build. Production release gate (AGENTS.md §4).
- SMS provider template `AUTH_OTP` text: «کد ورود شما به سنتو: {code}».
- Email sender display name (provider/env config).
- Telegram support handle, if it changes, in admin → تنظیمات → کانال‌های پشتیبانی.
- Search Console: add the new property and submit `https://centopay.ir/sitemap.xml`.
