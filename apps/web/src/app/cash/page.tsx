import type { Metadata } from "next";
import { ComingSoon } from "@/components/coming-soon";
import { NOINDEX } from "@/lib/seo";

/* A placeholder: nothing here yet for a search result to show. */
export const metadata: Metadata = { title: "نقد کردن ارز", ...NOINDEX };

export default function Page() { return <ComingSoon title="نقد کردن ارز" />; }
