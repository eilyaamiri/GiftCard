import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, BadgeCheck, Clock3, Info, ShieldCheck } from "lucide-react";
import { listTelegramGames, telegramProductOf, type TelegramProduct } from "@/lib/telegram";

export const metadata: Metadata = {
  title: "استارز و پرمیوم تلگرام | برات",
  description:
    "خرید استارز و اشتراک پرمیوم تلگرام با حساب کاربری خودتان؛ قیمت شفاف و تحویل مستقیم روی همان حساب.",
};

/**
 * The Telegram landing page.
 *
 * It is deliberately one screen of choosing, not a brochure: the two products
 * are the largest thing on it, and everything under them answers the questions
 * that decide a purchase — where the goods land, what it costs, and how long it
 * takes. Each product links to its own page; neither price is stated here,
 * because both are computed from a live rate at order time.
 */

type ProductCopy = {
  readonly product: TelegramProduct;
  readonly href: string;
  readonly name: string;
  readonly tone: string;
  readonly artwork: string;
  readonly lead: string;
  readonly facts: readonly string[];
};

const PRODUCTS: readonly ProductCopy[] = [
  {
    product: "stars",
    href: "/telegram/stars",
    name: "استارز تلگرام",
    tone: "stars",
    artwork: "/telegram-stars.svg",
    lead: "برای هدیه دادن به سازنده‌ها، باز کردن قفل محتوای کانال‌ها و خرید داخل ربات‌ها. بسته‌های ۵۰ تا ۱۰٬۰۰۰ استارز.",
    facts: ["۱۲ بسته آماده", "تحویل مستقیم پس از تأیید تأمین‌کننده", "بدون نیاز به رمز عبور"],
  },
  {
    product: "premium",
    href: "/telegram/premium",
    name: "پرمیوم تلگرام",
    tone: "premium",
    artwork: "/telegram-premium.svg",
    lead: "آپلود بزرگ‌تر، سرعت بالاتر، استیکر و ایموجی اختصاصی و نشان پرمیوم روی پروفایل. سه دورهٔ ۳، ۶ و ۱۲ ماهه.",
    facts: ["۳ دورهٔ ۳ / ۶ / ۱۲ ماهه", "روی حساب خودتان", "بدون نیاز به رمز عبور"],
  },
] as const;

export default async function TelegramLandingPage() {
  /* Read only to decide whether a product can be opened at all. The catalogue
   * is the authority on availability, so a product it does not publish is
   * shown as not-yet-available rather than linked into an empty page. */
  const games = await listTelegramGames();
  const available = new Set(games.map((game) => telegramProductOf(game)));

  return (
    <main>
      <section className="tg-hero">
        <div className="container tg-hero-inner">
          <div className="eyebrow">تلگرام</div>
          <h1 className="h1 tg-hero-title">استارز و پرمیوم تلگرام، روی حساب خودتان</h1>
          <p className="tg-hero-copy">
            کافی است نام کاربری تلگرام‌تان را وارد کنید. مبلغ را قبل از پرداخت می‌بینید و
            تأیید می‌کنید؛ استارز یا پرمیوم مستقیم به همان حساب می‌نشیند.
          </p>
          <div className="tg-hero-facts">
            <span><BadgeCheck size={15} aria-hidden="true" /> قیمت نهایی پیش از پرداخت</span>
            <span><ShieldCheck size={15} aria-hidden="true" /> بدون رمز عبور و کد ورود</span>
            <span><Clock3 size={15} aria-hidden="true" /> تحویل خودکار روی حساب</span>
          </div>
        </div>
      </section>

      <section className="container section tg-products-section">
        <div className="tg-products">
          {PRODUCTS.map((copy) => {
            const offline = !available.has(copy.product);
            return (
              <article key={copy.product} className={`card pad tg-product tg-product-${copy.tone}`}>
                <div className="tg-product-head">
                  <img className="tg-product-art" src={copy.artwork} alt="" width={64} height={64} aria-hidden="true" />
                  <div>
                    <h2 className="h3 tg-product-name">{copy.name}</h2>
                    <p className="muted tg-product-lead">{copy.lead}</p>
                  </div>
                </div>
                <ul className="tg-product-facts">
                  {copy.facts.map((fact) => (
                    <li key={fact}>{fact}</li>
                  ))}
                </ul>
                {offline ? (
                  <p className="alert warn tg-product-offline">
                    <Info size={14} aria-hidden="true" /> این محصول همین حالا قابل سفارش نیست.
                  </p>
                ) : (
                  <Link className="btn btn-primary tg-product-cta" href={copy.href}>
                    انتخاب بسته <ArrowLeft size={16} aria-hidden="true" />
                  </Link>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="container section tg-how">
        <div className="section-head">
          <div>
            <div className="eyebrow">روش کار</div>
            <h2 className="h2">سه قدم، بدون حساب واسط</h2>
          </div>
        </div>
        <div className="grid steps">
          <div className="card step">
            <span className="step-num">بسته</span>
            <h3>بسته یا دوره را انتخاب کنید</h3>
            <p className="muted">برای استارز، مقدار را از فهرست بردارید؛ برای پرمیوم، یکی از سه دوره.</p>
          </div>
          <div className="card step">
            <span className="step-num">حساب</span>
            <h3>نام کاربری تلگرام را وارد کنید</h3>
            <p className="muted">فقط شناسهٔ عمومی حساب. رمز عبور یا کد ورود هیچ‌وقت از شما گرفته نمی‌شود.</p>
          </div>
          <div className="card step">
            <span className="step-num">تأیید</span>
            <h3>مبلغ ریالی را ببینید و پرداخت کنید</h3>
            <p className="muted">قیمت با نرخ لحظه‌ای محاسبه می‌شود و پیش از پرداخت روی صفحه است.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
