import { useEffect, useState } from "react";
import { DinoRun } from "./dino/DinoRun";
import { SnakeGame } from "./snake/SnakeGame";
import { TicTacToe } from "./tictactoe/TicTacToe";
import { FlappyBird } from "./flappy/FlappyBird";
import { Arcade, type ArcadeGame } from "./Arcade";
import { getPlatform } from "../../platform";
import { highScore, padScore, type GameId } from "./scores";
import { useOpenGame } from "./openStore";
import { useNav } from "../../app/navStore";
import "./Games.css";

/** Where the section is: the front, or one of the games. */
type View = "arcade" | GameId;

/**
 * The suite, in the order the sub-nav lists them.
 *
 * This order is also the shell command's contract — `jky games 2` means the
 * second of these — which `openStore` asserts against.
 */
export const GAMES: ArcadeGame[] = [
  {
    id: "dino",
    label: "Dino Run",
    glyph: "🦖",
    blurb: "Jump the cactuses. It only gets faster.",
    scored: true,
    keys: "SPACE · ↓",
    tone: "mint",
    art: [
      "    ▄███▄      ",
      "    █▀█▀█   ▓  ",
      "▄▄▄██████  ▓▓▓ ",
      "███████▀    ▓  ",
      "───────────────",
    ],
  },
  {
    id: "snake",
    label: "Snake",
    glyph: "🐍",
    blurb: "Eat, grow, and try not to corner yourself.",
    scored: true,
    keys: "↑ ↓ ← → · SPACE",
    tone: "accent",
    art: [
      "┌─────────────┐",
      "│ ███▓▓▓    ◆ │",
      "│     ▓       │",
      "│     ▓▓▓▓    │",
      "└─────────────┘",
    ],
  },
  {
    id: "tictactoe",
    label: "Tic Tac Toe",
    glyph: "⨯○",
    blurb: "Two players, one keyboard.",
    scored: false,
    keys: "1 – 9 · ENTER",
    tone: "violet",
    art: [
      "   X │ O │ X   ",
      "  ───┼───┼───  ",
      "   O │ X │ O   ",
      "  ───┼───┼───  ",
      "   X │ O │ X   ",
    ],
  },
  {
    id: "flappy",
    label: "Flappy Bird",
    glyph: "🐦",
    blurb: "Mind the gap. The gap gets smaller.",
    scored: true,
    keys: "SPACE",
    tone: "warn",
    art: [
      "█▌       ▐█   ",
      "█▌  ▄██▖ ▐█   ",
      "      ▝▘      ",
      "█▌       ▐█   ",
      "▀▀▀▀▀▀▀▀▀▀▀▀▀ ",
    ],
  },
];

const LAST_VIEW_KEY = "jky.games.last";

function loadLastView(): View {
  try {
    const stored = localStorage.getItem(LAST_VIEW_KEY);
    if (stored === "arcade") return "arcade";
    if (GAMES.some((g) => g.id === stored)) return stored as GameId;
  } catch {
    // Storage can throw in a private window; the default is fine.
  }
  // The front, not a game: on a first visit the point is to see what is here.
  return "arcade";
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
  const [view, setView] = useState<View>(loadLastView);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_VIEW_KEY, view);
    } catch {
      // Preference lost, game fine.
    }
  }, [view]);

  // A game asked for from a shell wins over whichever was last played.
  const pendingGame = useOpenGame((s) => s.pending);
  useEffect(() => {
    if (!pendingGame) return;
    const taken = useOpenGame.getState().take();
    if (taken) setView(taken);
  }, [pendingGame]);

  // The palette can ask for the arcade front by name.
  const pendingNav = useNav((s) => s.pending);
  useEffect(() => {
    const wanted = useNav.getState().takePanel("games");
    if (wanted === "arcade") setView("arcade");
    else if (wanted && GAMES.some((g) => g.id === wanted)) setView(wanted as GameId);
  }, [pendingNav]);

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
  }, [view]);

  return (
    <div className="games">
      <nav className="games__nav" aria-label="Games">
        <h1 className="games__title">Games</h1>
        <ul>
          <li>
            <button
              type="button"
              className="games__link games__link--arcade"
              aria-current={view === "arcade" ? "page" : undefined}
              onClick={() => setView("arcade")}
            >
              <span className="games__index" aria-hidden="true">
                ◆
              </span>
              <span className="games__glyph" aria-hidden="true">
                ▤
              </span>
              <span className="games__label">Arcade</span>
            </button>
          </li>

          {GAMES.map((game, i) => (
            <li key={game.id}>
              <button
                type="button"
                className="games__link"
                aria-current={view === game.id ? "page" : undefined}
                onClick={() => setView(game.id)}
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
        {view === "arcade" && <Arcade games={GAMES} onPlay={setView} />}
        {view === "dino" && <DinoRun />}
        {view === "snake" && <SnakeGame />}
        {view === "tictactoe" && <TicTacToe />}
        {view === "flappy" && <FlappyBird />}
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
