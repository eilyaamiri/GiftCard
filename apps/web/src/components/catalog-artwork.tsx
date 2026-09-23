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
import { brandKey, hasBrandArt } from "@/lib/brand-art";

type ArtworkIcon = ComponentType<LucideProps>;

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
   * artwork itself is hidden rather than announced a second time.
   *
   * Artwork is transparent: the cover supplies the background, the file
   * supplies only the subject. Each is trimmed to its opaque bounds and fitted
   * to 800×600 — the trim matters as much as the resize, since it is what makes
   * a square render and a 4:3 one sit at the same apparent size on the shelf. */
  if (hasBrandArt(key)) {
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

  /* The fallback plate, for a brand with no art.
   *
   * The catalog no longer lists those brands, so this is reached only by
   * opening a product's page directly — an old link, or one someone saved. It
   * carries the brand's name rather than a guess at its subject: a per-brand
   * icon map would be three hundred entries of editorialising, and every brand
   * that earned a specific mark has real art above instead. */
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
