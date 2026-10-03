/**
 * The storefront's brand, in one place.
 *
 * Every customer-facing mention of the brand — the header and footer marks,
 * page titles, OpenGraph, JSON-LD, the sitemap and the assistant — reads from
 * here, so a future rename is a change to this file rather than a search.
 *
 * What this deliberately does not cover: technical identifiers that merely
 * carry the old name (`@barat/*` package scopes, the `barat_*` cookies, DI
 * tokens, storage keys). Renaming those would log every customer out or break
 * deploys for no visible gain, so they stay as they are.
 */

const DEFAULT_SITE_URL = "https://centopay.ir";

/**
 * The public origin canonicals, the sitemap and OpenGraph point at.
 *
 * `NEXT_PUBLIC_SITE_URL` lets a staging host advertise itself instead; it is
 * read at build time, so production must either set it to the real domain or
 * leave it unset. A trailing slash is dropped so paths join cleanly.
 */
export function siteUrl(): string {
  const configured = process.env["NEXT_PUBLIC_SITE_URL"]?.trim();
  return (configured === undefined || configured === "" ? DEFAULT_SITE_URL : configured).replace(/\/+$/u, "");
}

/** An absolute URL on the public origin, for canonicals and the sitemap. */
export function absoluteUrl(path: string): string {
  return `${siteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

export const BRAND = {
  name: "CENTO",
  nameFa: "سنتو",
  domain: "centopay.ir",
  url: DEFAULT_SITE_URL,
  tagline: "پرداخت دلاری با ریال",
  hero: {
    eyebrow: "CENTO · پرداخت جهانی با ریال",
    /* The headline is fixed copy: it is never rewritten, shortened or split
     * differently. `breakAfter` is where the desktop line break goes. */
    title: "چیزی که در جهان می‌خواهید، با ریال در دسترس شماست.",
    breakAfter: "می‌خواهید،",
    copy: "گیفت‌کارت بخرید، حساب بازی‌ها را شارژ کنید یا هزینه سرویس‌های بین‌المللی را با ریال پرداخت کنید. قیمت شفاف، پرداخت امن و پشتیبانی واقعی.",
    primaryCta: "خرید گیفت‌کارت",
    secondaryCta: "پرداخت بین‌المللی",
  },
  seo: {
    title: "سنتو | خرید گیفت‌کارت و پرداخت بین‌المللی با ریال",
    description:
      "سنتو؛ خرید گیفت‌کارت، شارژ مستقیم بازی و پرداخت هزینه سرویس‌های بین‌المللی با ریال، با قیمت شفاف و پرداخت امن.",
    locale: "fa_IR",
  },
  /** Under `public/`; `light`/`dark` name the theme the asset is drawn for. */
  assets: {
    logoLight: "/brand/cento/cento-logo-light.png",
    logoDark: "/brand/cento/cento-logo-dark.png",
    lockupLight: "/brand/cento/cento-lockup-light.png",
    lockupDark: "/brand/cento/cento-lockup-dark.png",
    symbol: "/brand/cento/cento-symbol.png",
    symbolLight: "/brand/cento/cento-symbol-light.png",
    symbolDark: "/brand/cento/cento-symbol-dark.png",
    appIconLight: "/brand/cento/cento-app-icon-light.png",
  },
} as const;

/** «… | سنتو», the suffix every page title carries. */
export const TITLE_TEMPLATE = `%s | ${BRAND.nameFa}`;

/**
 * The footer's year, in the Persian calendar and digits the site has always
 * used (it read «۱۴۰۵» when it was written by hand).
 */
export function copyrightYear(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric" }).format(now);
}

/* The storefront's former names. Searching for them still finds the help
 * articles that now say «سنتو», so a customer who remembers the old name is
 * not told there is nothing to read. Longest first, so «برات پی» is consumed
 * whole rather than leaving a stray «پی» behind. */
const FORMER_NAMES: readonly [RegExp, string][] = [
  [/برات\s*پی/gu, BRAND.nameFa],
  [/برات/gu, BRAND.nameFa],
  [/barat\s*-?\s*pay/giu, BRAND.name.toLowerCase()],
  [/barat/giu, BRAND.name.toLowerCase()],
];

/** A search term with any former brand name swapped for the current one. */
export function withCurrentBrandName(term: string): string {
  return FORMER_NAMES.reduce((value, [pattern, name]) => value.replace(pattern, name), term);
}
