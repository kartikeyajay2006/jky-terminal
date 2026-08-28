import type { GameId } from "./scores";

/**
 * How much each game has actually been played.
 *
 * Separate from `scores.ts` because it answers a different question: a high
 * score is the best you have ever done, this is how often you have tried.
 * Both live in browser storage for the same reason — the app produces them,
 * the user does not type them.
 */

const STATS_KEY = "jky.games.stats";

export interface GameStats {
  /** Rounds finished. */
  plays: number;
  /** Every point ever scored, across every round. */
  total: number;
}

export const EMPTY_STATS: GameStats = { plays: 0, total: 0 };

type AllStats = Partial<Record<GameId, GameStats>>;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function readAll(): AllStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return {};

    const out: AllStats = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== "object" || value === null) continue;
      const v = value as Record<string, unknown>;
      out[key as GameId] = {
        plays: isCount(v.plays) ? Math.floor(v.plays) : 0,
        total: isCount(v.total) ? Math.floor(v.total) : 0,
      };
    }
    return out;
  } catch {
    // Storage throws outright in a private window. Forgotten counts are a
    // shame; a game that will not start is a bug.
    return {};
  }
}

export function statsFor(game: GameId): GameStats {
  return { ...EMPTY_STATS, ...readAll()[game] };
}

/** Record a finished round. Returns the totals now standing. */
export function recordPlay(game: GameId, score: number): GameStats {
  const clean = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  const all = readAll();
  const current = all[game] ?? EMPTY_STATS;
  const next: GameStats = {
    plays: current.plays + 1,
    total: current.total + clean,
  };
  all[game] = next;
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(all));
  } catch {
    // The round still counted on screen.
  }
  return next;
}

/** Rounds played across every game, for the arcade's own header. */
export function totalPlays(): number {
  return Object.values(readAll()).reduce((n, s) => n + (s?.plays ?? 0), 0);
}

/**
 * The average score per round, or null before anything has been played.
 *
 * Null rather than zero: "you average nothing" and "you have not played" are
 * different statements, and only one of them is true on a first visit.
 */
export function averageScore(game: GameId): number | null {
  const { plays, total } = statsFor(game);
  if (plays === 0) return null;
  return Math.round(total / plays);
}
