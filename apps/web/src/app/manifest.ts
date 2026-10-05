import type { MetadataRoute } from "next";
import { BRAND } from "@/lib/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: BRAND.seo.title,
    short_name: BRAND.nameFa,
    description: BRAND.seo.description,
    lang: "fa",
    dir: "rtl",
    start_url: "/",
    display: "standalone",
    background_color: "#FFFFFF",
    theme_color: "#FFFFFF",
    icons: [
      /* Opaque and full-bleed. iOS builds the Home Screen icon from these and
       * shows any transparent edge as a white band; the rounded icon-192/512
       * keep a transparent margin top and bottom, so they stay tab-icon only. */
      { src: "/brand/cento/icon-opaque-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/cento/icon-opaque-512.png", sizes: "512x512", type: "image/png" },
      { src: "/brand/cento/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
