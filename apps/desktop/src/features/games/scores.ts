/**
 * High scores, and the tic-tac-toe tally.
 *
 * These live in browser storage rather than in `jky-store`, and the
 * distinction is deliberate: the store is the user's own content, governed by
 * "nothing gets removed until you remove it", and every record in it is
 * something they typed. A high score is neither — it is a fact about this
 * machine that the app produces on its own, in the same category as the
 * chosen theme and which notifications have been waved away, both of which
 * already live here.
 */

export type GameId = "dino" | "snake" | "tictactoe" | "flappy";

const HIGH_SCORE_KEY = "jky.games.highscores";
const TALLY_KEY = "jky.games.tictactoe";

type HighScores = Partial<Record<GameId, number>>;

function readHighScores(): HighScores {
  try {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    // Filter rather than trust: a hand-edited or half-written value must not
    // put a NaN on the scoreboard, where it would then beat every real score
    // it was ever compared against.
    const out: HighScores = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
        out[key as GameId] = Math.floor(value);
      }
    }
    return out;
  } catch {
    // Storage throws outright in a private window. A forgotten high score is
    // a disappointment; a game that will not start is a bug.
    return {};
  }
}

export function highScore(game: GameId): number {
  return readHighScores()[game] ?? 0;
}

/**
 * Record a score, keeping whichever is higher.
 *
 * Returns the score now standing, so a caller can tell a player they beat it
 * without reading storage a second time.
 */
export function submitScore(game: GameId, score: number): number {
  const clean = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  const scores = readHighScores();
  const best = Math.max(scores[game] ?? 0, clean);
  scores[game] = best;
  try {
    localStorage.setItem(HIGH_SCORE_KEY, JSON.stringify(scores));
  } catch {
    // Same reasoning as reading: the round still counts on screen.
  }
  return best;
}

export interface Tally {
  x: number;
  o: number;
  draws: number;
}

export const EMPTY_TALLY: Tally = { x: 0, o: 0, draws: 0 };

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function readTally(): Tally {
  try {
    const raw = localStorage.getItem(TALLY_KEY);
    if (!raw) return { ...EMPTY_TALLY };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...EMPTY_TALLY };
    const t = parsed as Record<string, unknown>;
    return {
      x: isCount(t.x) ? Math.floor(t.x) : 0,
      o: isCount(t.o) ? Math.floor(t.o) : 0,
      draws: isCount(t.draws) ? Math.floor(t.draws) : 0,
    };
  } catch {
    return { ...EMPTY_TALLY };
  }
}

export function writeTally(tally: Tally): void {
  try {
    localStorage.setItem(TALLY_KEY, JSON.stringify(tally));
  } catch {
    // Preference lost, game fine.
  }
}

/** Clear the running tally, for the button that offers exactly that. */
export function resetTally(): Tally {
  const fresh = { ...EMPTY_TALLY };
  writeTally(fresh);
  return fresh;
}

/** `01256` — a fixed-width score, the way an arcade cabinet shows it. */
export function padScore(score: number, width = 5): string {
  return String(Math.max(0, Math.floor(score))).padStart(width, "0");
}
