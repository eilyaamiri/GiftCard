import type { Metadata } from "next";
import { FaqSection } from "@/components/faq";
import { getFaqs } from "@/lib/faq";

export const metadata: Metadata = {
  title: "سؤال‌های متداول",
  description: "پاسخ پرسش‌های رایج دربارهٔ خرید گیفت‌کارت، قیمت‌گذاری، پرداخت و پیگیری سفارش.",
};

/**
 * The addressable home of the questions the landing page also closes with. Both
 * render `FaqSection` off one list, so the footer's «راهنما» link can never
 * disagree with what a visitor just read on the way down.
 */
export default async function HelpPage() {
  const faqs = await getFaqs();
  return (
    <main>
      <FaqSection
        entries={faqs}
        group="barat-help-faq"
        eyebrow="راهنما"
        action={{ href: "/account/support", label: "ثبت تیکت پشتیبانی" }}
      />
    </main>
  );
}
