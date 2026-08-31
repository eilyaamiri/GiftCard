import type { Metadata } from "next";
import { vazirmatn } from "@barat/ui/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "پنل عملیات برات پی",
  description: "پنل ادمین و میزکار اپراتور برات پی",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <body className="admin-app">{children}</body>
    </html>
  );
}
