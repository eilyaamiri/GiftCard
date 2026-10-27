import Link from "next/link";
import {
  gameImageUrl,
  gameMonogram,
  gameTitle,
  regionLabel,
  type TopUpGameSummary,
} from "@/lib/game-topups";

/**
 * The game grid.
 *
 * There is no search box here: the header's search already reaches every game
 * (`/search`), and a second box under the hero pushed the first row of games
 * below the fold on a phone. The whole shelf is a dozen cards, so it reads
 * faster scanned than filtered. `filterGames` stays in `lib/game-topups` — the
 * assistant uses it — and a local filter can come back here if the shelf grows.
 */
export function GameGrid({ games }: Readonly<{ games: readonly TopUpGameSummary[] }>) {
  return (
    <ul className="gt-grid">
      {games.map((game) => {
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
  );
}
