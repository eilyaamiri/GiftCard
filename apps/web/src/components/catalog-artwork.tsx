"use client";

import type { ComponentType } from "react";
import {
  Bot,
  ClipboardCheck,
  Cloud,
  CreditCard,
  Gift,
  Globe2,
  GraduationCap,
  PanelsTopLeft,
  type LucideProps,
} from "lucide-react";

type ArtworkIcon = ComponentType<LucideProps>;

/**
 * Brands we have real cover art for.
 *
 * The catalog carries 325 brands and only a few dozen will ever be drawn, so
 * this is an opt-in list: a brand that is not here keeps the generated
 * icon-on-plate mark below. Each entry is a slug, and the file is always
 * `/brand-art/<slug>.webp` — a naming rule rather than a second column, so the
 * two cannot drift apart.
 *
 * Artwork is transparent: the cover supplies the background, the file supplies
 * only the subject. Sources are ~1450px PNGs of about 2.8 MB each; they are
 * trimmed to their opaque bounds, fitted to 800×600 and re-encoded to WebP,
 * which keeps the alpha and brings each one down to around 100 KB. Trimming
 * matters as much as the resize — it is what makes a square render and a 4:3
 * one sit at the same apparent size on the shelf.
 */
const BRAND_ART: ReadonlySet<string> = new Set([
  "airbnb",
  "amazon",
  "apple",
  "blizzard",
  "fortnite",
  "free-fire",
  "google-play",
  "hotels-com",
  "jawaker",
  "netflix",
  "nike",
  "nintendo",
  "playstation",
  "pubg",
  "razer-gold",
  "roblox",
  "shein",
  "spotify",
  "steam",
  "tinder",
  "twitch",
  "uber",
  "xbox",
  "zara",
]);

/**
 * The key a brand's artwork, icon and palette are all filed under.
 *
 * Supplier feeds spell one brand several ways — "NetFlix" and "Netflix",
 * "Google play" and "Google Play" — so this follows the API's own `brandSlug`,
 * which is the key the brand filter already joins on. Products whose brand the
 * importer could not resolve have no slug; they fall back to the display name
 * put through the same normalisation, which is how `packages/database`'s
 * `brandSlug` derived the slug in the first place.
 */
function brandKey(brand: string, brandSlug: string | null | undefined): string {
  return (brandSlug ?? brand)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

const SERVICE_ICONS: Record<string, ArtworkIcon> = {
  "ai-tools": Bot,
  cloud: Cloud,
  "cloud-hosting": Cloud,
  courses: GraduationCap,
  "domain-hosting": Globe2,
  "exam-fees": ClipboardCheck,
  saas: PanelsTopLeft,
  "saas-subscriptions": PanelsTopLeft,
};

function imageAlt(label: string): string {
  return `تصویر ${label}`;
}

export function ProductArtwork({
  brand,
  brandSlug,
  label,
  size = "card",
}: Readonly<{
  brand: string;
  brandSlug?: string | null | undefined;
  label: string;
  size?: "card" | "detail";
}>) {
  const key = brandKey(brand, brandSlug);
  const frame = `catalog-art catalog-art-size-${size} product-art ${key}`;

  /* The wrapper is the image as far as assistive tech is concerned, so the
   * artwork itself is hidden rather than announced a second time. */
  if (BRAND_ART.has(key)) {
    return (
      <div className={`${frame} catalog-art-photo`} aria-label={imageAlt(label)} role="img">
        <span className="catalog-art-orbit" aria-hidden="true" />
        <span className="catalog-art-halo" aria-hidden="true" />
        <img
          className="catalog-art-figure"
          src={`/brand-art/${key}.webp`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
        />
      </div>
    );
  }

  /* The fallback plate carries the brand's name, not a guess at its subject: a
   * per-brand icon map would be three hundred entries of editorialising, and
   * every brand that earned a specific mark has real art above instead. */
  return (
    <div className={frame} aria-label={imageAlt(label)} role="img">
      <span className="catalog-art-orbit" aria-hidden="true" />
      <span className="catalog-art-plate" aria-hidden="true">
        <Gift size={size === "detail" ? 46 : 36} strokeWidth={1.7} />
        <strong dir="ltr">{brand}</strong>
      </span>
    </div>
  );
}

export function ServiceArtwork({
  category,
  label,
  size = "card",
  slug,
}: Readonly<{
  category: string;
  label: string;
  size?: "card" | "detail";
  slug: string;
}>) {
  const normalizedCategory = category.trim().toLowerCase();
  const normalizedSlug = slug.trim().toLowerCase();
  const ArtworkIcon = SERVICE_ICONS[normalizedSlug] ?? SERVICE_ICONS[normalizedCategory] ?? CreditCard;

  return (
    <div
      className={`catalog-art catalog-art-size-${size} service-art ${normalizedCategory}`}
      aria-label={imageAlt(label)}
      role="img"
    >
      <span className="catalog-art-orbit" aria-hidden="true" />
      <span className="service-art-symbol" aria-hidden="true">
        <ArtworkIcon size={size === "detail" ? 52 : 40} strokeWidth={1.55} />
      </span>
      <span className="service-art-payment" aria-hidden="true">
        <CreditCard size={15} />
        <span>پرداخت امن</span>
      </span>
    </div>
  );
}
