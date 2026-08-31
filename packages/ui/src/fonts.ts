import localFont from "next/font/local";

/** Next.js optimized Vazirmatn variable font (default, Latin digits). */
export const vazirmatn = localFont({
  src: [{ path: "../fonts/Vazirmatn[wght].woff2", weight: "100 900", style: "normal" }],
  variable: "--font-vazirmatn",
  display: "swap",
  preload: true,
  fallback: ["sans-serif"],
});

/**
 * Farsi-digit (FD) variant — renders 0-9 as Persian glyphs (۰-۹) at the font
 * level. No variable-weight FD build ships upstream, so Regular/Bold static
 * weights are used. Opt in with the `--font-vazirmatn-fd` CSS variable where
 * native Persian-digit rendering (without the toPersianDigits helper) is
 * preferred.
 */
export const vazirmatnFd = localFont({
  src: [
    { path: "../fonts/Vazirmatn-FD-Regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/Vazirmatn-FD-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-vazirmatn-fd",
  display: "swap",
  preload: false,
  fallback: ["sans-serif"],
});

/** Plain CSS for non-Next consumers (inject into a stylesheet or style tag). */
export const vazirmatnFontFace = `@font-face{font-family:Vazirmatn;src:url('/fonts/Vazirmatn[wght].woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}
@font-face{font-family:'Vazirmatn FD';src:url('/fonts/Vazirmatn-FD-Regular.woff2') format('woff2');font-style:normal;font-weight:400;font-display:swap}
@font-face{font-family:'Vazirmatn FD';src:url('/fonts/Vazirmatn-FD-Bold.woff2') format('woff2');font-style:normal;font-weight:700;font-display:swap}`;
