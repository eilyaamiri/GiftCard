import type { Metadata } from "next";
import { HomePage } from "@/components/marketing";
import { BRAND } from "@/lib/brand";

/* `absolute`, not the template: the home title already leads with the brand. */
export const metadata: Metadata = {
  title: { absolute: BRAND.seo.title },
  alternates: { canonical: "/" },
};

export default function Page() { return <HomePage/>; }
