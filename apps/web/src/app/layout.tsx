import type { Metadata } from "next";
import { vazirmatn } from "@barat/ui/fonts";
import { Providers } from "./providers";
import { getSession } from "@/lib/session";
import { getSupportChannels } from "@/lib/support-channels";
import { SiteChrome } from "@/components/site-chrome";
import "./globals.css";

export const metadata: Metadata = { title: "برات | پرداخت جهانی، ساده و مطمئن", description: "خرید گیفت‌کارت و پرداخت سرویس‌های بین‌المللی با برات" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  /* Both reads are per-request and independent, so they overlap rather than
   * queueing. The contact channels are admin-editable configuration, which is
   * why they are fetched here instead of being written into the component. */
  const [customer, supportChannels] = await Promise.all([getSession(), getSupportChannels()]);
  /* `vazirmatn.variable` is what actually ships the @font-face: without it the
   * stylesheet asks for "Vazirmatn" and the browser only finds it on a machine
   * that happens to have it installed locally. Desktops used by the team do;
   * phones never do, which is why the storefront read in a fallback Arabic face
   * there while looking correct here. */
  return <html lang="fa" dir="rtl" className={vazirmatn.variable}><body><Providers><SiteChrome customer={customer} supportChannels={supportChannels}>{children}</SiteChrome></Providers></body></html>;
}
