import { highScore, padScore, readTally, type GameId } from "./scores";
import { averageScore, statsFor, totalPlays } from "./stats";

export interface ArcadeGame {
  id: GameId;
  label: string;
  glyph: string;
  blurb: string;
  scored: boolean;
  /** The keys that play it, spelled out on the card. */
  keys: string;
  /** A few rows of art, so a card shows the game rather than describing it. */
  art: string[];
  tone: "mint" | "accent" | "violet" | "warn";
}

/**
 * The arcade's front.
 *
 * Four cards rather than dropping straight into whichever game was played
 * last: it is the one place that shows everything at once, which is what
 * makes a suite feel like a suite. Each card carries its own record, so the
 * thing you would actually want to know — am I going to beat it — is on
 * screen before you have chosen.
 */
export function Arcade({
  games,
  onPlay,
}: {
  games: ArcadeGame[];
  onPlay: (id: GameId) => void;
}) {
  const plays = totalPlays();
  const tally = readTally();

  return (
    <section className="arcade" aria-label="Arcade">
      <header className="arcade__head">
        <div>
          <h2 className="arcade__title">JKY ARCADE</h2>
          <p className="arcade__sub">
            Four games, played from the keyboard. Records are kept on this
            machine.
          </p>
        </div>
        <dl className="arcade__totals" aria-label="Arcade totals">
          <div>
            <dt>ROUNDS</dt>
            <dd>{padScore(plays, 3)}</dd>
          </div>
          <div>
            <dt>X · O</dt>
            <dd>
              {tally.x} · {tally.o}
            </dd>
          </div>
        </dl>
      </header>

      <div className="arcade__grid">
        {games.map((game, i) => (
          <ArcadeCard key={game.id} game={game} index={i + 1} onPlay={onPlay} />
        ))}
      </div>

      <p className="arcade__hint">
        In a terminal, <code>jky games</code> lists these with their records
        and <code>jky games 1</code> opens one.
      </p>
    </section>
  );
}

function ArcadeCard({
  game,
  index,
  onPlay,
}: {
  game: ArcadeGame;
  index: number;
  onPlay: (id: GameId) => void;
}) {
  const best = highScore(game.id);
  const { plays } = statsFor(game.id);
  const average = averageScore(game.id);

  return (
    <article className="acard" data-tone={game.tone} aria-label={game.label}>
      <header className="acard__head">
        <span className="acard__index" aria-hidden="true">
          {index}
        </span>
        <span className="acard__glyph" aria-hidden="true">
          {game.glyph}
        </span>
        <h3 className="acard__title">{game.label}</h3>
      </header>

      <pre className="acard__art" aria-hidden="true">
        {game.art.join("\n")}
      </pre>

      <p className="acard__blurb">{game.blurb}</p>

      <dl className="acard__stats">
        {game.scored ? (
          <>
            <div>
              <dt>BEST</dt>
              <dd>{best > 0 ? padScore(best, 4) : "—"}</dd>
            </div>
            <div>
              <dt>AVG</dt>
              <dd>{average !== null ? padScore(average, 4) : "—"}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>MODE</dt>
            <dd>2P</dd>
          </div>
        )}
        <div>
          <dt>ROUNDS</dt>
          <dd>{plays}</dd>
        </div>
      </dl>

      <footer className="acard__foot">
        <span className="acard__keys">{game.keys}</span>
        <button
          type="button"
          className="acard__play"
          onClick={() => onPlay(game.id)}
        >
          PLAY ▸
        </button>
      </footer>
    </article>
  );
}
