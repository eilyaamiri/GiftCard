"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  filterGames,
  gameImageUrl,
  gameMonogram,
  gameTitle,
  regionLabel,
  type TopUpGameSummary,
} from "@/lib/game-topups";

/**
 * The searchable game grid.
 *
 * Search is local: the whole shelf is already on the page, and filtering in the
 * browser answers on every keystroke without a round trip. The count under the
 * box is announced politely so a screen-reader user hears the result change.
 */
export function GameGrid({ games }: Readonly<{ games: readonly TopUpGameSummary[] }>) {
  const [query, setQuery] = useState("");
  const shown = useMemo(() => filterGames(games, query), [games, query]);

  return (
    <>
      <div className="gt-toolbar">
        <label className="catalog-search gt-search">
          <Search size={17} aria-hidden="true" />
          <input
            type="search"
            value={query}
            maxLength={80}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جست‌وجوی نام بازی"
            aria-label="جست‌وجوی نام بازی"
          />
        </label>
        <p className="muted gt-count" aria-live="polite">
          {shown.length.toLocaleString("fa-IR")} بازی
        </p>
      </div>

      {shown.length === 0 ? (
        <p className="card pad gt-no-match">
          بازی‌ای با این نام پیدا نشد. نام انگلیسی یا بخشی از آن را امتحان کنید.
        </p>
      ) : (
        <ul className="gt-grid">
          {shown.map((game) => {
            const image = gameImageUrl(game);
            const region = regionLabel(game.region);
            return (
              <li key={game.id}>
                <Link href={`/games/${encodeURIComponent(game.slug)}`} className="card gt-card">
                  <span className="gt-card-art" aria-hidden="true">
                    {image !== null ? (
                      <img src={image} alt="" loading="lazy" width={72} height={72} />
                    ) : (
                      <span className="gt-card-monogram">{gameMonogram(game)}</span>
                    )}
                  </span>
                  <span className="gt-card-body">
                    <strong className="gt-card-title">{gameTitle(game)}</strong>
                    {gameTitle(game) !== game.name ? (
                      <span className="gt-card-sub" dir="ltr">{game.name}</span>
                    ) : null}
                    <span className="gt-card-meta">
                      {region !== null ? <span className="gt-chip">{region}</span> : null}
                      {game.offerCount !== undefined && game.offerCount > 0 ? (
                        <span className="gt-chip">{game.offerCount.toLocaleString("fa-IR")} بسته</span>
                      ) : null}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
