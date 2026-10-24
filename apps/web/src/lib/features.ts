/**
 * Storefront features that can be switched off without deleting their code.
 *
 * `INTERNATIONAL_PAYMENT_ENABLED` hides «پرداخت بین‌المللی» (`/services` and
 * `/services/<slug>`): its links in the header, drawer, footer, home page,
 * search, sitemap and category lists, the assistant's menu entry, and the
 * pages themselves, which answer 404 while it is off. Nothing was removed, so
 * turning it back on is this one constant and a redeploy.
 *
 * It is a constant rather than an env var on purpose: it is read by client
 * components too, and a `NEXT_PUBLIC_*` value is frozen at build time anyway.
 */
export const INTERNATIONAL_PAYMENT_ENABLED = false;

/**
 * Drops the links that lead into a hidden feature. A service-list category an
 * operator curated can hold `SERVICE` links, which resolve to `/services/<slug>`.
 */
export function visibleCategoryLinks<T extends { readonly type: string }>(links: readonly T[]): readonly T[] {
  return INTERNATIONAL_PAYMENT_ENABLED ? links : links.filter((link) => link.type !== "SERVICE");
}
