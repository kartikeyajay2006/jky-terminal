/**
 * The three seconds between pressing start and the game actually starting.
 *
 * Worth having rather than dropping someone straight into a moving world:
 * every arcade game does this, and the reason is that the first obstacle
 * arrives before a player has found the keys otherwise.
 */

/** How long each of "3", "2", "1", "GO" is on screen. */
export const TICK_MS = 480;

/** The words shown, in order. */
export const STEPS = ["3", "2", "1", "GO"] as const;

export const TOTAL_MS = TICK_MS * STEPS.length;

/**
 * What to show after `elapsed` milliseconds, or null once it is over.
 *
 * A pure function of elapsed time rather than a countdown that mutates: the
 * caller already has a frame clock, and one source of truth for "how far in
 * are we" is easier to reason about than two that can drift.
 */
export function countdownWord(elapsedMs: number): string | null {
  if (elapsedMs < 0) return STEPS[0];
  const index = Math.floor(elapsedMs / TICK_MS);
  return index < STEPS.length ? STEPS[index] : null;
}

/** Has the countdown finished, so the world should start moving? */
export function countdownDone(elapsedMs: number): boolean {
  return elapsedMs >= TOTAL_MS;
}

/**
 * How far through the current word we are, from 1 down to 0.
 *
 * Used to swell each number as it appears, which is what makes a countdown
 * read as a countdown rather than as three characters flickering.
 */
export function countdownPulse(elapsedMs: number): number {
  if (elapsedMs < 0) return 1;
  const into = elapsedMs % TICK_MS;
  return 1 - into / TICK_MS;
}

/**
 * The countdown drawn large.
 *
 * At one character tall a "3" is lost among scenery — on Dino Run it landed
 * in the middle of a mountain ridge and read as terrain. Five rows of blocks
 * is unmistakably a countdown even at a glance.
 */
const BIG: Record<string, string[]> = {
  "3": [
    "█████",
    "    █",
    " ████",
    "    █",
    "█████",
  ],
  "2": [
    "█████",
    "    █",
    "█████",
    "█    ",
    "█████",
  ],
  "1": [
    "  ██ ",
    "   █ ",
    "   █ ",
    "   █ ",
    " ████",
  ],
  GO: [
    "██  ██ ██ ",
    "█   █  █ █",
    "█ █ █  █ █",
    "█ █ █  █ █",
    "███ ██ ██ ",
  ],
};

/** The rows for a countdown word, or an empty list if there is no art. */
export function bigWord(word: string): string[] {
  return BIG[word] ?? [];
}

/** How tall the block art is, for callers laying out around it. */
export const BIG_ROWS = 5;
