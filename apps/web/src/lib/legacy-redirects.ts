/**
 * Permanent redirects for URLs retired by the CENTO rebrand.
 *
 * The one registry: `apps/web/next.config.ts` serves exactly this list, and
 * docs/rebrand/redirects.md documents it. Every entry goes straight to its
 * final URL (no chains), and every internal link already points at the
 * destination, so these only ever answer old bookmarks and search results.
 *
 * `permanent: true` makes Next answer 308, the method-preserving 301.
 */
export type LegacyRedirect = { readonly source: string; readonly destination: string; readonly permanent: true };

export const LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  { source: "/barat-card", destination: "/cento-card", permanent: true },
  { source: "/help/:category/what-is-barat", destination: "/help/:category/what-is-cento", permanent: true },
];
