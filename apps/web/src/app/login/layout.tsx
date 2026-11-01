import type { Metadata } from "next";
import { NOINDEX } from "@/lib/seo";

/* The sign-in page is a client component, which cannot export metadata, so the
 * `noindex` lives on its layout. */
export const metadata: Metadata = { title: "ورود", ...NOINDEX };

export default function LoginLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
