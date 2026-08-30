import type { Metadata } from "next";
import Link from "next/link";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = { title: "برات | پرداخت جهانی، ساده و مطمئن", description: "خرید گیفت‌کارت و پرداخت سرویس‌های بین‌المللی با برات" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fa" dir="rtl"><body><Providers><header className="header"><div className="container header-inner"><Link href="/" className="logo" aria-label="برات، صفحه اصلی"><span className="logo-mark">ب</span>برات</Link><nav className="nav" aria-label="منوی اصلی"><Link href="/gift-cards">گیفت‌کارت‌ها</Link><Link href="/services">پرداخت بین‌المللی</Link><Link href="/orders">پیگیری سفارش</Link><Link href="/help">راهنما</Link></nav><div className="header-actions"><Link className="btn btn-outline" href="/login">ورود</Link><Link className="btn btn-primary" href="/gift-cards">شروع خرید</Link></div></div></header>{children}<footer className="footer"><div className="container footer-inner"><div><div className="logo"><span className="logo-mark">ب</span>برات</div><p>ارزش جهانی، به زبان ریال.</p></div><div>پشتیبانی همه‌روزه · پاسخ‌گویی سریع</div><div>© ۱۴۰۵ برات</div></div></footer></Providers></body></html>;
}
