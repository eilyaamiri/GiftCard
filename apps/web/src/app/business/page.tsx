import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { NOINDEX } from "@/lib/seo";

/* A placeholder: nothing here yet for a search result to show. */
export const metadata: Metadata = { title: "سنتو کسب‌وکار", ...NOINDEX };

export default function Page() { return <ComingSoon title="سنتو کسب‌وکار" />; }
