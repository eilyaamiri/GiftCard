import type { Metadata } from "next";
import { Providers } from "./providers";
import { getSession } from "@/lib/session";
import { SiteChrome } from "@/components/site-chrome";
import "./globals.css";

export const metadata: Metadata = { title: "برات | پرداخت جهانی، ساده و مطمئن", description: "خرید گیفت‌کارت و پرداخت سرویس‌های بین‌المللی با برات" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const customer = await getSession();
  return <html lang="fa" dir="rtl"><body><Providers><SiteChrome customer={customer}>{children}</SiteChrome></Providers></body></html>;
}
