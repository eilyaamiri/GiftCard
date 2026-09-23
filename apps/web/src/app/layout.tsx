import type { Metadata } from "next";
import { vazirmatn } from "@barat/ui/fonts";
import { Providers } from "./providers";
import { getSession } from "@/lib/session";
import { getSupportChannels } from "@/lib/support-channels";
import { getNavFacets } from "@/lib/nav-facets";
import { SiteChrome } from "@/components/site-chrome";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = { title: "برات | پرداخت جهانی، ساده و مطمئن", description: "خرید گیفت‌کارت و پرداخت سرویس‌های بین‌المللی با برات" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /* All three reads are per-request and independent, so they overlap rather
   * than queueing. The contact channels and the nav's categories/brands are
   * both admin-editable, which is why they are fetched here instead of being
   * written into the component. */
  const [customer, supportChannels, navFacets] = await Promise.all([
    getSession(),
    getSupportChannels(),
    getNavFacets(),
  ]);
  /* `vazirmatn.variable` is what actually ships the @font-face: without it the
   * stylesheet asks for "Vazirmatn" and the browser only finds it on a machine
   * that happens to have it installed locally. Desktops used by the team do;
   * phones never do, which is why the storefront read in a fallback Arabic face
   * there while looking correct here. */
  return (
    /* `suppressHydrationWarning` covers exactly one attribute: `data-theme`,
     * which the inline script below writes onto this element before React ever
     * sees it. It is scoped to `<html>` itself and does not extend to the tree. */
    <html lang="fa" dir="rtl" className={vazirmatn.variable} suppressHydrationWarning>
      <head>
        {/* Before first paint, so a customer on the dark theme is never shown a
            white page for a frame first. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <Providers>
          <SiteChrome
            customer={customer}
            supportChannels={supportChannels}
            categories={navFacets.categories}
            brands={navFacets.brands}
          >
            {children}
          </SiteChrome>
        </Providers>
      </body>
    </html>
  );
}
