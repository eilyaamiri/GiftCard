import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Gamepad2, ShieldCheck, Zap } from "lucide-react";
import { listGameTopUps } from "@/lib/game-topups";
import { GameGrid } from "./_components/game-grid";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "شارژ مستقیم بازی | برات",
  description:
    "شارژ مستقیم حساب بازی با شناسهٔ بازیکن؛ بدون کد و بدون رمز عبور. قیمت نهایی پیش از پرداخت نمایش داده می‌شود.",
};

/**
 * The games shelf: every direct top-up that is not Telegram.
 *
 * A direct top-up credits the customer's own game account from the player id
 * they type, so there is no code to deliver and nothing to redeem — the copy
 * here says exactly that, because it is the one thing that makes this shelf
 * different from the gift-card catalogue next door.
 *
 * No price appears on this page. Each game's price is computed from a live
 * rate when the customer asks for a quote on the game's own page.
 */
export default async function GamesPage() {
  const games = await listGameTopUps();

  return (
    <main>
      <section className="tg-hero gt-hero">
        <div className="container tg-hero-inner">
          <div className="eyebrow">شارژ مستقیم</div>
          <h1 className="h1 tg-hero-title">شارژ بازی، مستقیم روی حساب خودتان</h1>
          <p className="tg-hero-copy">
            شناسهٔ بازیکن را وارد کنید و بسته را انتخاب کنید. کدی تحویل نمی‌گیرید که وارد کنید؛
            شارژ مستقیم به همان حساب بازی می‌نشیند.
          </p>
          <div className="tg-hero-facts">
            <span><BadgeCheck size={15} aria-hidden="true" /> قیمت نهایی پیش از پرداخت</span>
            <span><ShieldCheck size={15} aria-hidden="true" /> بدون رمز عبور حساب بازی</span>
            <span><Zap size={15} aria-hidden="true" /> تحویل خودکار روی حساب</span>
          </div>
        </div>
      </section>

      <section className="container section gt-section">
        {games.length === 0 ? (
          <div className="card pad gt-empty">
            <Gamepad2 size={28} aria-hidden="true" />
            <h2 className="h3">فعلاً بازی‌ای برای شارژ مستقیم فعال نیست</h2>
            <p className="muted">
              فهرست بازی‌ها به‌زودی تکمیل می‌شود. تا آن موقع می‌توانید گیفت‌کارت بازی بخرید یا
              استارز و پرمیوم تلگرام را روی حساب خودتان شارژ کنید.
            </p>
            <div className="tg-unavailable-actions">
              <Link className="btn btn-primary" href="/gift-cards">گیفت‌کارت‌ها</Link>
              <Link className="btn btn-outline" href="/telegram">استارز و پرمیوم تلگرام</Link>
            </div>
          </div>
        ) : (
          <GameGrid games={games} />
        )}
      </section>
    </main>
  );
}
