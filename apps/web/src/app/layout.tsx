import type { Metadata, Viewport } from "next";
import { vazirmatn } from "@barat/ui/fonts";
import { Providers } from "./providers";
import { getSession } from "@/lib/session";
import { getSupportChannels } from "@/lib/support-channels";
import { getNavFacets } from "@/lib/nav-facets";
import { SiteChrome } from "@/components/site-chrome";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { BRAND, TITLE_TEMPLATE, absoluteUrl, siteUrl } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  /* Pages give their own short title; the template adds «| سنتو» once, so no
   * page writes the brand into its title itself. */
  title: { default: BRAND.seo.title, template: TITLE_TEMPLATE },
  description: BRAND.seo.description,
  applicationName: BRAND.nameFa,
  openGraph: {
    type: "website",
    siteName: BRAND.name,
    locale: BRAND.seo.locale,
    title: BRAND.seo.title,
    description: BRAND.seo.description,
    images: [{ url: BRAND.assets.ogImage, width: 1200, height: 1200, alt: BRAND.nameFa }],
  },
  twitter: { card: "summary", title: BRAND.seo.title, description: BRAND.seo.description },
  /* The tab icon follows the browser's own scheme: the white tile would sink
   * into a dark tab strip, so dark browsers get the black one. */
  icons: {
    icon: [
      { url: "/brand/cento/favicon.ico", sizes: "any" },
      { url: "/brand/cento/favicon-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: light)" },
      { url: "/brand/cento/favicon-dark-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: dark)" },
      { url: "/brand/cento/icon-192.png", type: "image/png", sizes: "192x192" },
    ],
    apple: "/brand/cento/apple-touch-icon.png",
  },
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FFFFFF" },
    { media: "(prefers-color-scheme: dark)", color: "#002B28" },
  ],
};

/* Organization + WebSite, so search engines can tie the domain to the brand
 * name in both scripts. Built from constants only — nothing user-supplied is
 * ever interpolated into this script tag. */
const STRUCTURED_DATA = JSON.stringify([
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: BRAND.name,
    alternateName: BRAND.nameFa,
    url: absoluteUrl("/"),
    logo: absoluteUrl(BRAND.assets.logoLight),
    slogan: BRAND.tagline,
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: BRAND.nameFa,
    alternateName: BRAND.name,
    url: absoluteUrl("/"),
    inLanguage: "fa-IR",
    potentialAction: {
      "@type": "SearchAction",
      target: `${absoluteUrl("/search")}?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  },
]).replace(/</gu, "\\u003c");

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
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: STRUCTURED_DATA }} />
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
