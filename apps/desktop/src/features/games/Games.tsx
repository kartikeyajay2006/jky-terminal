import { useEffect, useState } from "react";
import { DinoRun } from "./dino/DinoRun";
import { SnakeGame } from "./snake/SnakeGame";
import { TicTacToe } from "./tictactoe/TicTacToe";
import { FlappyBird } from "./flappy/FlappyBird";
import { getPlatform } from "../../platform";
import { highScore, padScore, type GameId } from "./scores";
import { useOpenGame } from "./openStore";
import "./Games.css";

interface GameSpec {
  id: GameId;
  label: string;
  glyph: string;
  blurb: string;
  /** Whether this game keeps a high score, for the sub-nav to show one. */
  scored: boolean;
}

/** The suite, in the order the sub-nav lists them. */
export const GAMES: GameSpec[] = [
  {
    id: "dino",
    label: "Dino Run",
    glyph: "🦖",
    blurb: "Jump the cactuses. It only gets faster.",
    scored: true,
  },
  {
    id: "snake",
    label: "Snake",
    glyph: "🐍",
    blurb: "Eat, grow, and try not to corner yourself.",
    scored: true,
  },
  {
    id: "tictactoe",
    label: "Tic Tac Toe",
    glyph: "⨯○",
    blurb: "Two players, one keyboard.",
    scored: false,
  },
  {
    id: "flappy",
    label: "Flappy Bird",
    glyph: "🐦",
    blurb: "Mind the gap. The gap gets smaller.",
    scored: true,
  },
];

const LAST_PLAYED_KEY = "jky.games.last";

function loadLastPlayed(): GameId {
  try {
    const stored = localStorage.getItem(LAST_PLAYED_KEY);
    if (GAMES.some((g) => g.id === stored)) return stored as GameId;
  } catch {
    // Storage can throw in a private window; the default is fine.
  }
  return "dino";
}

/**
 * The Games section.
 *
 * Only the chosen game is mounted, which matters more here than anywhere else
 * in the app: each of the three action games runs a `requestAnimationFrame`
 * loop, and mounting all four would leave three of them painting boards
 * nobody is looking at. Unmounting is also what stops a game the moment you
 * walk away from it, so a dinosaur is not still running into cactuses while
 * you read your notes.
 */
export function Games() {
  const [active, setActive] = useState<GameId>(loadLastPlayed);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_PLAYED_KEY, active);
    } catch {
      // Preference lost, game fine.
    }
  }, [active]);

  // A game asked for from a shell wins over whichever was last played.
  const pendingGame = useOpenGame((s) => s.pending);
  useEffect(() => {
    if (!pendingGame) return;
    const taken = useOpenGame.getState().take();
    if (taken) setActive(taken);
  }, [pendingGame]);

  // Hand the shell listing its numbers whenever this section is on screen.
  // Scores live in browser storage, which `jky games` cannot see, so without
  // this the listing would be written once and never again — and running it
  // after beating your record would show the old one.
  useEffect(() => {
    const scores = GAMES.filter((g) => g.scored).map((g) => ({
      id: g.id,
      best: highScore(g.id),
    }));
    void getPlatform().games.publishScores(scores).catch(() => {});
  }, [active]);

  return (
    <div className="games">
      <nav className="games__nav" aria-label="Games">
        <h1 className="games__title">Games</h1>
        <ul>
          {GAMES.map((game, i) => (
            <li key={game.id}>
              <button
                type="button"
                className="games__link"
                aria-current={active === game.id ? "page" : undefined}
                onClick={() => setActive(game.id)}
              >
                <span className="games__index" aria-hidden="true">
                  {i + 1}
                </span>
                <span className="games__glyph" aria-hidden="true">
                  {game.glyph}
                </span>
                <span className="games__label">{game.label}</span>
                {game.scored && <HiScore id={game.id} />}
              </button>
            </li>
          ))}
        </ul>

        <p className="games__note">
          Every game is played from the keyboard. High scores are kept on this
          machine.
        </p>
      </nav>

      <div className="games__stage">
        {active === "dino" && <DinoRun />}
        {active === "snake" && <SnakeGame />}
        {active === "tictactoe" && <TicTacToe />}
        {active === "flappy" && <FlappyBird />}
      </div>
    </div>
  );
}

/**
 * The best score beside a game's name.
 *
 * Read on every render rather than held in state, because the number changes
 * in a sibling component: the game that just ended writes it, and this has no
 * way of hearing about that. Re-reading is a single synchronous storage
 * lookup and only happens when the section re-renders anyway.
 */
function HiScore({ id }: { id: GameId }) {
  const best = highScore(id);
  if (best <= 0) return null;
  return <span className="games__score">{padScore(best, 4)}</span>;
}
