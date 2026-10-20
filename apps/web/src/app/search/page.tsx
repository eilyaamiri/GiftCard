import Link from "next/link";
import { ArrowLeft, SearchX } from "lucide-react";
import { EmptyState, ErrorState } from "@barat/ui";
import { api, ApiClientError } from "@/lib/api";
import { catalogQueryString } from "@/lib/catalog";
import { gameTitle, imageUrlOf, isSteamEntry, isTelegramEntry, regionLabel } from "@/lib/game-topups";
import { CatalogProductCard } from "@/components/catalog-product-card";
import { ServiceCard } from "@/components/service-card";
import type { ListTopUpGamesResponse } from "@/lib/catalog";

export const metadata = {
  title: "جست‌وجو",
  description: "جست‌وجو در گیفت‌کارت‌ها، شارژ بازی، تلگرام، استیم و سرویس‌های پرداخت بین‌المللی.",
};

export const dynamic = "force-dynamic";

/** How many gift-card results to show before pointing to the full catalog. */
const PRODUCTS_SHOWN = 8;

function readTerm(raw: string | string[] | undefined): string {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (value ?? "").trim().slice(0, 120);
}

/** Game card for the search results. */
function GameCard({ game }: { game: ListTopUpGamesResponse["items"][number] }) {
  const image = imageUrlOf(game);
  const region = regionLabel(game.region);
  const href = isTelegramEntry(game)
    ? "/telegram"
    : isSteamEntry(game)
      ? "/steam"
      : `/games/${encodeURIComponent(game.slug)}`;

  return (
    <Link href={href} className="card gt-card">
      <span className="gt-card-art" aria-hidden="true">
        {image !== null ? (
          <img src={image} alt="" loading="lazy" width={72} height={72} />
        ) : (
          <span className="gt-card-monogram">{gameTitle(game).slice(0, 1)}</span>
        )}
      </span>
      <span className="gt-card-body">
        <strong className="gt-card-title">{gameTitle(game)}</strong>
        {gameTitle(game) !== game.name ? (
          <span className="gt-card-sub" dir="ltr">{game.name}</span>
        ) : null}
        <span className="gt-card-meta">
          {region !== null ? <span className="gt-chip">{region}</span> : null}
          {game.offerCount > 0 ? (
            <span className="gt-chip">{game.offerCount} بسته</span>
          ) : null}
        </span>
      </span>
    </Link>
  );
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const term = readTerm((await searchParams).q);

  if (!term) {
    return (
      <main className="page container">
        <div className="eyebrow">جست‌وجو</div>
        <h1 className="h2">جست‌وجو در سنتو</h1>
        <EmptyState
          icon={<SearchX />}
          title="عبارتی برای جست‌وجو وارد نشده"
          description="نام یک گیفت‌کارت، برند، بازی یا سرویس پرداخت خارجی را در کادر جست‌وجوی بالای صفحه بنویسید."
        />
      </main>
    );
  }

  let products;
  let services;
  let topUps;
  try {
    [products, services, topUps] = await Promise.all([
      api.products(catalogQueryString({ search: term, pageSize: PRODUCTS_SHOWN, onlyAvailable: false })),
      api.services({ search: term, pageSize: 50 }),
      api.topUps(term),
    ]);
  } catch (error) {
    return (
      <main className="page container">
        <ErrorState
          title="جست‌وجو در دسترس نیست"
          description={error instanceof ApiClientError ? error.message : "ارتباط با سرویس ممکن نیست. لطفاً دوباره تلاش کنید."}
          action={<Link className="btn btn-primary" href={`/search?q=${encodeURIComponent(term)}`}>تلاش دوباره</Link>}
        />
      </main>
    );
  }

  const totalCount = products.meta.total + services.meta.total + topUps.items.length;
  /* Fail-open: a pricing hiccup costs the cards their «از ...» label only. */
  const fromPrices = await api.fromPrices(products.items.map((product) => product.id));

  return (
    <main className="page container">
      <div className="eyebrow">جست‌وجو</div>
      <h1 className="h2">نتایج جست‌وجو برای «{term}»</h1>

      {totalCount === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title="چیزی پیدا نشد"
          description="نام دیگری برای گیفت‌کارت، برند، بازی یا سرویس پرداخت خارجی امتحان کنید."
        />
      ) : (
        <div className="services-category-stack" style={{ marginTop: 22 }}>
          {topUps.items.length > 0 ? (
            <section>
              <div className="section-head">
                <div>
                  <div className="eyebrow">شارژ مستقیم</div>
                  <h2 className="h2">شارژ مستقیم بازی و تلگرام</h2>
                </div>
              </div>
              <ul className="gt-grid">
                {topUps.items.map((game) => (
                  <li key={game.id}>
                    <GameCard game={game} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {products.items.length > 0 ? (
            <section>
              <div className="section-head">
                <div>
                  <div className="eyebrow">گیفت‌کارت‌ها</div>
                  <h2 className="h2">گیفت‌کارت‌ها</h2>
                </div>
                {products.meta.total > products.items.length ? (
                  <Link className="btn btn-ghost" href={`/gift-cards?q=${encodeURIComponent(term)}`}>
                    دیدن همه <ArrowLeft size={16} />
                  </Link>
                ) : null}
              </div>
              <div className="grid catalog-grid">
                {products.items.map((product) => (
                  <CatalogProductCard key={product.id} product={product} fromPriceIrr={fromPrices[product.id]} />
                ))}
              </div>
            </section>
          ) : null}

          {services.items.length > 0 ? (
            <section>
              <div className="section-head">
                <div>
                  <div className="eyebrow">پرداخت بین‌المللی</div>
                  <h2 className="h2">پرداخت هزینه سرویس‌های خارجی</h2>
                </div>
                <Link className="btn btn-ghost" href="/services">
                  دیدن همه <ArrowLeft size={16} />
                </Link>
              </div>
              <div className="grid catalog-grid">
                {services.items.map((service) => (
                  <ServiceCard key={service.slug} service={service} />
                ))}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </main>
  );
}
