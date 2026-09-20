/**
 * A brand's visual identity when it has no uploaded logo.
 *
 * Most of the catalog's 300-plus brands arrived from the supplier feed with no
 * artwork at all, and this storefront has no way to fetch one — there is no
 * outbound path to a logo CDN from either this app or the server it runs on.
 * So every brand gets a designed mark instead: two initials on a background
 * drawn from the site's own palette, picked deterministically from the brand's
 * name so the same brand always renders the same way.
 */

const PALETTE = [
  { base: "#0B1D33", accent: "#21B4B0" },
  { base: "#102A46", accent: "#46D0CB" },
  { base: "#13243A", accent: "#D98B19" },
  { base: "#102A46", accent: "#18A66A" },
  { base: "#0B1D33", accent: "#6B7C93" },
  { base: "#13243A", accent: "#46D0CB" },
  { base: "#102A46", accent: "#D98B19" },
] as const;

function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (Math.imul(h, 31) + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** A background/accent pair from the site's palette, stable per brand key. */
export function brandAccent(key: string): { readonly base: string; readonly accent: string } {
  return PALETTE[hash(key) % PALETTE.length] ?? PALETTE[0];
}

/** Up to two letters: one per word for a multi-word name, two from a single word. */
export function brandInitials(name: string): string {
  const words = name
    .replaceAll(/[^\p{L}\p{N}'’]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .map((word) => word.replaceAll(/^['’]+|['’]+$/gu, ""))
    .filter(Boolean);
  const [first, second] = words;
  if (first === undefined) return "?";
  if (second === undefined) return first.slice(0, 2).toUpperCase();
  return (first.slice(0, 1) + second.slice(0, 1)).toUpperCase();
}
