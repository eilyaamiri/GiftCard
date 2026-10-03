import type { Metadata } from "next";
import { vazirmatn } from "@barat/ui/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "پنل عملیات سنتو",
  description: "پنل ادمین و میزکار اپراتور سنتو",
  robots: { index: false, follow: false },
  icons: {
    icon: [
      { url: "/brand/cento/favicon.ico", sizes: "any" },
      { url: "/brand/cento/favicon-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: light)" },
      { url: "/brand/cento/favicon-dark-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/brand/cento/apple-touch-icon.png",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fa" dir="rtl" className={vazirmatn.variable}>
      <body className="admin-app">{children}</body>
    </html>
  );
}
