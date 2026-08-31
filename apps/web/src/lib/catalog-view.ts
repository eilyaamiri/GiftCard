/**
 * Presentation-only helpers for the customer catalog. Nothing here talks to
 * the API — it only shapes what `@barat/contracts` DTOs already carry.
 */

const BRAND_TONES: Record<string, string> = {
  apple: "apple",
  playstation: "play",
  steam: "steam",
  "google play": "google",
};

/** Maps a brand to one of the handful of gradient tones defined in globals.css. */
export function brandTone(brand: string): string {
  return BRAND_TONES[brand.trim().toLowerCase()] ?? "";
}
