"use client";

import type { ComponentType, CSSProperties } from "react";
import {
  Apple,
  Bot,
  Clapperboard,
  ClipboardCheck,
  Cloud,
  CreditCard,
  Gamepad2,
  Globe2,
  GraduationCap,
  PackageOpen,
  PanelsTopLeft,
  Play,
  type LucideProps,
} from "lucide-react";
import { brandAccent, brandInitials } from "@/lib/brand-mark";

type ArtworkIcon = ComponentType<LucideProps>;

const BRAND_ICONS: Record<string, ArtworkIcon> = {
  apple: Apple,
  amazon: PackageOpen,
  "google play": Play,
  netflix: Clapperboard,
  playstation: Gamepad2,
  steam: Gamepad2,
  xbox: Gamepad2,
};

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
  label,
  size = "card",
}: Readonly<{
  brand: string;
  label: string;
  size?: "card" | "detail";
}>) {
  const normalizedBrand = brand.trim().toLowerCase();
  const ArtworkIcon = BRAND_ICONS[normalizedBrand];
  /* Most brands have no curated icon and no uploaded logo, so they get a
   * designed mark instead: initials on an accent drawn from the same palette
   * as the rest of the site, picked deterministically from the brand name. */
  const accent = ArtworkIcon ? null : brandAccent(normalizedBrand);

  return (
    <div
      className={`catalog-art catalog-art-size-${size} product-art ${normalizedBrand.replaceAll(" ", "-")}`}
      style={accent ? ({ "--art-base": accent.base, "--art-accent": accent.accent } as CSSProperties) : undefined}
      aria-label={imageAlt(label)}
      role="img"
    >
      <span className="catalog-art-orbit" aria-hidden="true" />
      <span className="catalog-art-plate" aria-hidden="true">
        {ArtworkIcon ? (
          <ArtworkIcon size={size === "detail" ? 46 : 36} strokeWidth={1.7} />
        ) : (
          <span className="catalog-art-monogram">{brandInitials(brand)}</span>
        )}
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
