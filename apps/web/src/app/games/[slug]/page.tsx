import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowRight, Info } from "lucide-react";
import { gameImageUrl, gameMonogram, gameTitle, getGameTopUp, regionLabel } from "@/lib/game-topups";
import { GameOrderForm } from "../_components/game-order-form";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const lookup = await getGameTopUp(slug);
  if (lookup.kind !== "game") return { title: "شارژ مستقیم بازی | برات" };
  const title = gameTitle(lookup.game);
  return {
    title: `شارژ مستقیم ${title} | برات`,
    description: `شارژ مستقیم ${title} روی حساب خودتان با شناسهٔ بازیکن؛ قیمت نهایی پیش از پرداخت.`,
  };
}

/**
 * One game: pick a package, say which account, get a quote.
 *
 * A game the catalogue does not sell right now is a 404 — the storefront does
 * not keep a dead page up for it. A Telegram entry reached by its slug is sent
 * to `/telegram`, which knows how to ask for a Telegram username.
 */
export default async function GamePage({ params }: Params) {
  const { slug } = await params;
  const lookup = await getGameTopUp(slug);
  if (lookup.kind === "telegram") redirect("/telegram");
  if (lookup.kind === "missing") notFound();

  const { game, offers } = lookup;
  const title = gameTitle(game);
  const image = gameImageUrl(game);
  const region = regionLabel(game.region);

  return (
    <main className="page container tg-order-page">
      <nav className="tg-breadcrumb" aria-label="مسیر صفحه">
        <Link href="/games">شارژ بازی</Link>
        <span aria-hidden="true">/</span>
        <span>{title}</span>
      </nav>

      <header className="tg-order-head">
        <span className="gt-card-art gt-order-art" aria-hidden="true">
          {image !== null ? (
            <img src={image} alt="" width={64} height={64} />
          ) : (
            <span className="gt-card-monogram">{gameMonogram(game)}</span>
          )}
        </span>
        <div>
          <h1 className="h2">شارژ مستقیم {title}</h1>
          <p className="muted">
            {game.descriptionFa ?? "بسته را انتخاب کنید و مشخصات حساب بازی را وارد کنید تا قیمت نهایی را ببینید."}
          </p>
          {region !== null ? (
            <p className="gt-order-region">
              منطقه: <span className="gt-chip">{region}</span>
            </p>
          ) : null}
        </div>
      </header>

      {game.providerNote ? (
        <p className="alert tg-order-note">
          <Info size={14} aria-hidden="true" /> {game.providerNote}
        </p>
      ) : null}

      <GameOrderForm
        offers={offers.map((offer) => ({
          id: offer.id,
          label: offer.nameFa?.trim() || offer.name,
          hint: offer.nameFa?.trim() ? offer.name : null,
        }))}
        fields={game.fields ?? []}
      />

      <p className="tg-order-foot">
        <ArrowRight size={14} aria-hidden="true" /> شارژ پس از تأیید پرداخت و پاسخ تأمین‌کننده انجام می‌شود؛
        اگر خرید انجام نشود، پشتیبانی وضعیت سفارش و بازگشت وجه را پیگیری می‌کند.
      </p>
    </main>
  );
}
