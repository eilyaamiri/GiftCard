import localFont from "next/font/local";

/** Next.js optimized Vazirmatn variable font. */
export const vazirmatn = localFont({
  src: [{ path: "../fonts/Vazirmatn[wght].woff2", weight: "100 900", style: "normal" }],
  variable: "--font-vazirmatn",
  display: "swap",
  preload: true,
  fallback: ["sans-serif"],
});

/** Plain CSS for non-Next consumers (inject into a stylesheet or style tag). */
export const vazirmatnFontFace = `@font-face{font-family:Vazirmatn;src:url('/fonts/Vazirmatn[wght].woff2') format('woff2');font-style:normal;font-weight:100 900;font-display:swap}`;
