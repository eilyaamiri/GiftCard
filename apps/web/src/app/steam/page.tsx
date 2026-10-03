import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Clock3, Info, ShieldCheck } from "lucide-react";
import { getSteamTopUp, steamLoginField, STEAM_LOGIN_KEY } from "@/lib/steam";
import { SteamOrderForm } from "./_components/steam-order-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "شارژ کیف پول استیم",
  description:
    "شارژ مستقیم کیف پول استیم فقط با شناسهٔ ورود (Login)؛ بدون رمز عبور و کد. قیمت نهایی پیش از پرداخت نمایش داده می‌شود.",
};

/**
 * The Steam wallet top-up.
 *
 * One screen: the customer states the Steam login, types a USD amount, and is
 * taken to a quote. The wallet is credited with exactly that amount once the
 * payment is confirmed. No price appears here — the Rial price is the live
 * supplier cost at the moment the quote is asked for.
 */
export default async function SteamPage() {
  const entry = await getSteamTopUp();
  const field = entry === null ? undefined : steamLoginField(entry.game);

  return (
    <main>
      <section className="tg-hero steam-hero">
        <div className="container tg-hero-inner">
          <div className="eyebrow">استیم</div>
          <h1 className="h1 tg-hero-title">شارژ کیف پول استیم، فقط با شناسهٔ ورود</h1>
          <p className="tg-hero-copy">
            شناسهٔ ورود حساب استیم و مبلغ دلاری دلخواه را وارد کنید. بعد از تأیید پرداخت، همان مبلغ مستقیم
            به کیف پول استیم می‌نشیند.
          </p>
          <div className="tg-hero-facts">
            <span><BadgeCheck size={15} aria-hidden="true" /> قیمت نهایی پیش از پرداخت</span>
            <span><ShieldCheck size={15} aria-hidden="true" /> بدون رمز عبور و Steam Guard</span>
            <span><Clock3 size={15} aria-hidden="true" /> تحویل خودکار روی حساب</span>
          </div>
        </div>
      </section>

      <section className="container section steam-section">
        {entry === null ? (
          <div className="card pad tg-unavailable">
            <div className="eyebrow">در دسترس نیست</div>
            <h2 className="h2">شارژ کیف پول استیم</h2>
            <p className="muted">
              این سرویس همین حالا قابل سفارش نیست. ممکن است موجودی یا اتصال به تأمین‌کننده قطع باشد؛
              چیزی از شما کسر نشده است.
            </p>
            <div className="tg-unavailable-actions">
              <Link className="btn btn-outline" href="/gift-cards">گیفت‌کارت‌ها</Link>
              <Link className="btn btn-ghost" href="/help">تماس با پشتیبانی</Link>
            </div>
          </div>
        ) : (
          <div className="steam-order">
            <header className="card pad steam-order-head">
              <h2 className="h3">{entry.game.nameFa ?? "شارژ کیف پول استیم"}</h2>
              <p className="muted">با شناسهٔ ورود و مبلغ دلاری دلخواه، قیمت نهایی را ببینید.</p>
            </header>

            {entry.game.providerNote ? (
              <p className="alert tg-order-note">
                <Info size={14} aria-hidden="true" /> {entry.game.providerNote}
              </p>
            ) : null}

            <SteamOrderForm
              accountKey={field?.key ?? STEAM_LOGIN_KEY}
              loginLabel={field?.labelFa ?? field?.label ?? "شناسهٔ ورود استیم"}
              loginHint={field?.helpTextFa ?? "شناسهٔ ورود (Login) حساب استیم را وارد کنید؛ نه نام نمایشی."}
              validationRegex={field?.validationRegex ?? null}
              offerId={entry.offerId}
            />

            <p className="tg-order-foot">
              تحویل پس از تأیید پرداخت و پاسخ تأمین‌کننده انجام می‌شود؛ اگر شارژ انجام نشود، پشتیبانی
              وضعیت سفارش و بازگشت وجه را پیگیری می‌کند.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
