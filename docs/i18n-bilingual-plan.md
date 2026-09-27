# Bilingual storefront + account panel (fa/en), cookie-based switcher

> Status: **planned, not started**. Do not begin implementation until explicitly
> asked to resume. This file is the durable copy of a plan produced in an earlier
> session (Plan Mode, approved) — see "Execution efficiency notes" below for how
> to resume it cheaply.

## Context

`apps/web` ("Barat") is Persian-only and RTL-only today — `apps/web/src/app/layout.tsx`
hardcodes `<html lang="fa" dir="rtl">` and a Persian `metadata` object, and there is zero
i18n infrastructure anywhere in the repo (confirmed via repo-wide search: no `next-intl`,
`next-i18next`, `react-intl`, no `next.config.ts` `i18n` key). The goal is an English
version of the site with a language switcher in the footer and the user menu, covering the
public storefront and the customer account panel, on both desktop and mobile.
**`apps/admin` and the operator panel are explicitly out of scope and untouched.**

Confirmed architecture decisions (both asked and answered explicitly before planning):
- **Library: `next-intl`** — the scale here (~30 routes, interpolated strings like
  "{N} اعلان خوانده‌نشده", status dictionaries) justifies a real i18n library over a
  hand-rolled dictionary.
- **URL strategy: same URL, cookie-only** (`barat_locale`) — no `/en/...` prefix, no
  `[locale]` route-segment restructuring, no rewriting any existing `<Link href="/orders">`.
  Persian stays the default when the cookie is absent.

This is a large effort (~40 files carry hardcoded Persian copy). It ships as a sequence of
small PRs, matching this repo's existing one-feature-per-branch convention — the switcher
becomes visibly functional after the first PR, before the remaining PRs migrate content
phase by phase.

## Architecture

**Dependency & layout** — add `next-intl` to `apps/web/package.json` only.
```
apps/web/src/
  i18n/
    locales.ts    # locales = ['fa','en'] as const, defaultLocale = 'fa'
    request.ts    # getRequestConfig — reads the `barat_locale` cookie via next/headers cookies()
  messages/
    fa.json       # single flat file, nested namespaces (chrome, marketing, account, status, ...)
    en.json
```
`next.config.ts` gets one additive wrap: `createNextIntlPlugin('./src/i18n/request.ts')(nextConfig)`
— nothing else in that file (rewrites/headers/env) changes.

**No middleware/proxy change.** `apps/web/src/middleware.ts` only guards `/account*` on
`barat_session` cookie presence; it has nothing to do with locale in cookie-only mode and
must not be touched for this feature. (Aside, not part of this work: it still uses Next 16's
deprecated `middleware`/`middleware.ts` name rather than the renamed `proxy`/`proxy.ts` per
`node_modules/next/dist/docs/.../16-proxy.md` — unrelated tech debt, do not bundle it in.)

**No new font.** `packages/config/tailwind/theme.css` sets `--font-sans` to Vazirmatn
unconditionally (not scoped to `[dir="rtl"]`), and Vazirmatn already renders the Latin glyphs
used today inside `.bp-ltr`-isolated money/code spans. English pages render in the same font.

**Root layout (`apps/web/src/app/layout.tsx`)**: becomes locale-aware —
`<html lang={locale} dir={locale === 'fa' ? 'rtl' : 'ltr'} ...>`, wrapped in
`<NextIntlClientProvider locale={locale} messages={messages}>` around the existing
`<Providers>`. Add `getLocale()`/`getMessages()` into the layout's existing `Promise.all`
(alongside `getSession()`, `getSupportChannels()`, `getNavFacets()`) so it doesn't add
sequential latency. The static `export const metadata` becomes `generateMetadata()` reading
an ICU message via `getTranslations({ locale, namespace: 'metadata' })`; the same change
applies to the 6 route files that already export their own `metadata`/`generateMetadata`
(`gift-cards`, `brands`, `search`, `help`, `help/[categorySlug]`, `help/[categorySlug]/[articleSlug]`).

**`LocaleToggle` component** (new: `apps/web/src/components/locale-toggle.tsx`) — modeled on
the existing `theme-toggle.tsx` (`apps/web/src/components/theme-toggle.tsx:33-104`, a
`role="group"` of buttons, `withLabels` prop for the wide variant). The flip mechanic differs
from theme (which is pure `localStorage` + a `data-theme` attribute + a same-tab
`CustomEvent` for sync, since the server never sees it): locale changes what the *server*
renders, so `LocaleToggle` instead:
1. Sets `document.cookie = "barat_locale=<next>; path=/; max-age=31536000; SameSite=Lax"`
   (add `Secure` when `location.protocol === "https:"`).
2. Calls `router.refresh()` (`next/navigation`) — re-runs `getRequestConfig` and every server
   component (including `layout.tsx`'s `lang`/`dir`) with the new cookie, updating all
   `useTranslations()` output through `NextIntlClientProvider`'s refreshed `messages` prop.
   No `CustomEvent` bus needed (unlike theme) since the cookie is server-visible.
3. `router.refresh()` preserves client component state (open `<details>`/`<dialog>`, form
   inputs, scroll) — verify empirically that the account profile-menu `<details>` and mobile
   `<dialog>` stay open across the click (see Verification).

Mounted in exactly the 4 places asked for:
- `site-chrome.tsx`'s `.header-end` div (`apps/web/src/components/site-chrome.tsx:117-118`),
  beside `<ThemeToggle />`.
- `site-chrome.tsx`'s `.footer-legal` (`site-chrome.tsx:260-262`), beside the copyright line
  — keeps the existing 3-column footer grid untouched, matches "footer" literally.
- `mobile-nav-drawer.tsx`'s `.mobile-nav-drawer-theme` settings row (~line 140-143, the
  existing "حالت نمایش" + `<ThemeToggle withLabels />` block) — add a sibling row, same
  treatment.
- Account "user menu": `account-topbar-actions.tsx`'s profile dropdown
  (`.account-profile-menu`, lines 190-217) — insert between the shortcuts `<nav>` (ends line
  214) and `.account-profile-separator`/`<LogoutButton/>`, so it reads as an account-level
  setting, not a nav shortcut. **Plus** a mobile-specific mount in
  `account-mobile-drawer.tsx`'s footer (`.account-sidebar-footer`) — confirmed this drawer
  does **not** reuse `AccountTopbarActions`, so it needs its own instance, not just a desktop one.

## Phased rollout (5 PRs, `feat/i18n-*` branches off fresh `origin/main`)

**PR 1 — `feat/i18n-foundation`** (infra + chrome; switcher goes live end-to-end here):
`next-intl` setup (`i18n/locales.ts`, `i18n/request.ts`, `next.config.ts` wrap), root
`layout.tsx` locale wiring + `generateMetadata`, the new `LocaleToggle`, and translating
`site-chrome.tsx` (nav labels, search placeholders/aria-labels, auth CTA, footer),
`mobile-nav-drawer.tsx`, `mobile-bottom-nav.tsx`'s 4 tab labels, and `service-categories.ts`
(see Special cases). ~8-10 files, ~60-80 strings. After this PR: switcher works in all 4
slots, on desktop and mobile, even though most page bodies are still Persian.

**PR 2 — `feat/i18n-homepage-marketing`**: `marketing.tsx` (336 lines, ~790 Persian chars —
the single densest file, used by the homepage) and `coming-soon.tsx` (shared by 5 routes:
`barat-card`/`business`/`cash`/`transfer`/`wallet`), plus those 5 routes' `generateMetadata`.

**PR 3 — `feat/i18n-storefront-catalog`** (largest; split into 3a/3b if diff size is a
problem): remaining ~15 public route files + colocated components —
3a: browsing (`gift-cards`, `brands`, `services`, `search`, `help` chrome — article bodies
themselves are DB-authored markdown, out of scope, only the page shell translates);
3b: transactional (`checkout`, `payment`, `quote`, `orders`, `login`, `otp`) — pulls in
`status.ts` here since order/payment status labels are read on these pages.

**PR 4 — `feat/i18n-account-panel`**: all 8 `/account/**` routes + `account/layout.tsx` +
`account-topbar-actions.tsx`, `account-mobile-drawer.tsx`, `account-sidebar-nav.tsx`,
`account-nav.tsx` (consolidate the 3x-duplicated nav-label sources here, see Special cases),
`logout-button.tsx`, `profile-form.tsx`, `email-form.tsx`, `support-form.tsx` (value/label
split, see Special cases), `reply-form.tsx`, and `bank-account-form.tsx` (314 lines, by far
the heaviest single file — dense legal/attestation prose; carve into its own follow-up PR if
the English attestation wording needs separate sign-off). Wires the two account
`LocaleToggle` mounts from PR 1's component.

**PR 5 — `feat/i18n-status-dictionary`**: convert `status.ts`'s
`ORDER_STATUS_VIEW`/`PAYMENT_STATUS_VIEW`/`REFUND_STATUS_VIEW`/`SUPPORT_STATUS_VIEW`/
`PAYMENT_FAILURE_TEXT` (keyed by stable backend enum strings, not Persian — mechanical, not a
translation-quality risk) from literal dictionaries to `useTranslations`/`getTranslations`
lookups. Sequenced last since both PR 3 and PR 4 call into it — audit each call site for
hook (client) vs. async (server) usage during this pass.

## Special-case handling

- **`service-categories.ts`**: change `{ slug, labelFa }` → `{ slug, labelKey }`, consumed via
  `useTranslations('serviceCategories')` at the two call sites (`site-chrome.tsx`,
  `mobile-nav-drawer.tsx`). Keep `slug` untouched (used in URLs).
- **Account nav triplication**: `account-sidebar-nav.tsx`'s `groups`, `account-nav.tsx`'s
  `links`, and `account-topbar-actions.tsx`'s `SHORTCUTS` each independently hardcode Persian
  labels for the same ~6 destinations, with existing wording drift (confirmed: "سفارش‌های من"
  vs "سفارش‌ها" for `/account/orders`). Consolidate into one
  `apps/web/src/lib/account-nav-items.ts` (`{ href, labelKey, icon }[]`) in PR 4, called out
  explicitly in that PR's description as "also fixes pre-existing wording drift."
- **`support-form.tsx` TOPICS**: currently `{ value: "پیگیری سفارش", label: "پیگیری سفارش" }`
  where `value` is posted to the backend as the ticket subject. Change to
  `{ value: "پیگیری سفارش", labelKey: "orderTracking" }` — `value` stays Persian and
  unchanged regardless of UI language (backend contract must not regress), only `labelKey`'s
  rendered text localizes. Quick grep of `apps/api` for anything matching on these exact
  subject strings before touching this file.
- **Backend-authored free text — do NOT translate**: account notification `title`/`body`
  (`/api/account/notifications`), support ticket `message.body`/`resolutionNote`, and
  knowledge-base article markdown bodies are user/staff/admin-authored content, not static UI
  chrome. Only the labels/chrome around them (headings, loading/empty states, the
  `"{N} اعلان خوانده‌نشده"` aria-label template via next-intl's ICU plural support) translate.
- **RTL/LTR isolation utilities** (`Ltr.tsx`, `Input`'s `ltr` prop, `.bp-ltr` CSS) are
  unrelated to this feature and must not be touched. Before PR 1 ships, run
  `grep -rn "\[dir=.rtl.\]" apps/web/src/app/globals.css packages/config/tailwind/theme.css`
  to confirm no isolation rule is silently scoped to `[dir="rtl"]` only (which would stop
  applying under `dir="ltr"` English pages).

## Verification

Per phase: `pnpm --filter @barat/web typecheck`, `pnpm --filter @barat/web lint`,
`pnpm --filter @barat/web test` (no new tests added, per this project's convention — never
add a Playwright test without asking first).

Browser (via the preview tools), at minimum after PR 1 and PR 4 — do not re-verify every
single subsequent PR in a live browser; a typecheck/lint pass plus a spot-check of the new
strings in both locales is enough for PRs 2/3/5 (see Execution efficiency notes):
1. Confirm default `document.documentElement.lang/.dir` is `"fa"`/`"rtl"` with no cookie.
2. Click the desktop header `LocaleToggle` → confirm cookie set, `<html lang/dir>` flips to
   `"en"`/`"ltr"`, header/nav/footer switch to English with no full navigation
   (`preview_network` shows an RSC refresh, not a full document GET).
3. Confirm the footer switcher instance stays in sync with the header one.
4. Mobile (`preview_resize`): open the nav drawer, confirm the settings row beside
   `ThemeToggle` works.
5. On `/account` (signed in): open the profile-menu, confirm the switcher row sits between
   shortcuts and logout and works; confirm the `<details>` stays open across the
   `router.refresh()` it triggers.
6. Mobile: open `AccountMobileDrawer`, confirm its own switcher row works independently.
7. Toggle back to Persian from each of the 4 slots, confirm `dir="rtl"` restores with no
   layout breakage; spot-check an order amount's `.bp-ltr` isolation in both directions.
8. `preview_console_logs` (errors) after each toggle — watch for hydration mismatches.
9. Once each PR lands, spot-check its own new content in both locales (e.g. PR 4: the
   support topic dropdown, to confirm the value/label split holds end-to-end).

### Critical files
- apps/web/src/app/layout.tsx
- apps/web/src/components/site-chrome.tsx
- apps/web/src/components/mobile-nav-drawer.tsx
- apps/web/src/components/theme-toggle.tsx (pattern to mirror)
- apps/web/src/components/account-topbar-actions.tsx
- apps/web/src/components/account-mobile-drawer.tsx
- apps/web/src/lib/service-categories.ts
- apps/web/src/lib/status.ts
- apps/web/src/app/account/support/support-form.tsx
- apps/web/next.config.ts

## Execution efficiency notes (added before resuming)

The planning phase itself (3 `Explore` agents + 1 `Plan` agent) cost roughly a quarter
million subagent tokens to produce the architecture above. That work is done and does not
need to be repeated. The architecture, file list, and line numbers in this document are
already confirmed by direct reads (`layout.tsx`, `site-chrome.tsx`, `theme-toggle.tsx`,
`next.config.ts` were read in full; the rest came from agent synthesis and still need a
first-hand read immediately before editing each file, but not before then). When resuming,
apply these rules to keep the remaining ~5 PRs cheap:

1. **No further `Explore`/`Plan` agent dispatches for this feature.** The architecture is
   fixed and approved. Any additional investigation needed for a specific PR (e.g. confirming
   a line number before an edit) should be a direct `Read`/`grep` in the main session, not a
   subagent dispatch — subagent research was the expensive part, not the editing.
2. **One PR per session/turn block, not one long continuous session for all 5.** Each PR
   phase should be started fresh (new conversation or at least explicit context reset) rather
   than carrying the entire accumulated exploration/edit history of prior PRs forward —
   conversation history that keeps growing re-sends the same tokens on every subsequent turn.
   This plan file is what makes that possible: a fresh session only needs to read this file,
   not re-derive the architecture.
3. **Read narrowly.** For large files where only certain lines are being touched (e.g.
   `bank-account-form.tsx` at 314 lines, `marketing.tsx` at 336 lines), grep for the specific
   Persian strings or JSX blocks being touched instead of reading the whole file when a
   targeted `Read` with `offset`/`limit` will do — full-file reads are only mandatory the
   first time a file is touched in a session, not on every subsequent edit within the same PR.
   `theme-toggle.tsx`, `site-chrome.tsx`, `next.config.ts`, and `layout.tsx` are already fully
   read (see above) and do not need re-reading, only the diffs against what's documented here.
4. **Mechanical, pattern-repeating edits should be done directly, not via agent dispatch.**
   Extracting `labelFa`/hardcoded Persian JSX into `t('key')` calls across a fixed list of
   known files is repetitive but not exploratory — a single agent worker should not be spun
   up per file; do it with direct `Edit` calls in the main session, batched per file.
5. **Limit live browser verification to the checkpoints already named above** (after PR 1 and
   PR 4) rather than a full `preview_*` pass on every PR — PRs 2/3/5 are typecheck+lint+spot
   grep of the new `messages/*.json` keys, not full interactive re-verification.
6. **Do not re-run the `[dir="rtl"]` isolation grep more than once** — it's a one-time
   pre-flight check before PR 1 ships, not a per-PR check.

Net effect: the remaining implementation should look like ordinary direct-edit work (Read a
known file, Edit it, typecheck, commit) for 5 small PRs, not a repeat of the research-heavy
process that produced this document.
