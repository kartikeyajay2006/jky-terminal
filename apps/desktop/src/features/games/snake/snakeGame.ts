/**
 * Snake — the rules.
 *
 * A snake moves in whole cells on a fixed tick, which is why this game keeps
 * a step interval rather than a speed in cells per second: half a cell of
 * snake is not a thing, and the interval is what actually shortens as the
 * game gets harder.
 */

export const COLS = 44;
export const ROWS = 22;

export type Dir = "up" | "down" | "left" | "right";
export type Phase = "ready" | "running" | "paused" | "over";

export interface Point {
  x: number;
  y: number;
}

/** Milliseconds between moves at the very start. */
export const START_INTERVAL_MS = 130;
/**
 * The fastest the snake is allowed to get.
 *
 * Below about sixty milliseconds a turn entered on one frame arrives after
 * the snake has already passed the corner, so the game stops responding to
 * what the player actually pressed.
 */
export const MIN_INTERVAL_MS = 62;
/** How much quicker each apple makes it. */
export const SPEEDUP_MS = 3.5;

export interface SnakeState {
  phase: Phase;
  /** Head first, tail last. */
  body: Point[];
  dir: Dir;
  /**
   * The direction actually applied on the last tick.
   *
   * Turns are checked against this rather than against `dir`, or two quick
   * presses within one tick — right then down then up — could reverse the
   * snake into its own neck before it had moved at all.
   */
  movedDir: Dir;
  food: Point;
  score: number;
  intervalMs: number;
  /** Grows pending from eating; the tail is kept while this is positive. */
  grow: number;
}

export function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

export const OPPOSITE: Record<Dir, Dir> = {
  up: "down",
  down: "up",
  left: "right",
  right: "left",
};

const DELTA: Record<Dir, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

/**
 * Somewhere free to put an apple.
 *
 * Walks the free cells rather than guessing repeatedly: a long snake makes
 * rejection sampling take unboundedly many tries, and on a nearly full board
 * it can spin for thousands of iterations inside a single frame.
 */
export function placeFood(body: Point[], rand: () => number): Point {
  const taken = new Set(body.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) return { x: 0, y: 0 };
  return free[Math.floor(rand() * free.length)];
}

export function initialState(rand: () => number = makeRandom(7)): SnakeState {
  const body: Point[] = [
    { x: 10, y: 11 },
    { x: 9, y: 11 },
    { x: 8, y: 11 },
    { x: 7, y: 11 },
  ];
  return {
    phase: "ready",
    body,
    dir: "right",
    movedDir: "right",
    food: placeFood(body, rand),
    score: 0,
    intervalMs: START_INTERVAL_MS,
    grow: 0,
  };
}

/**
 * Ask the snake to turn.
 *
 * A reversal is ignored rather than fatal — pressing left while going right
 * is a slip, and killing someone for it feels arbitrary.
 */
export function turn(s: SnakeState, dir: Dir): void {
  if (s.phase !== "running") return;
  if (dir === OPPOSITE[s.movedDir]) return;
  s.dir = dir;
}

/** Advance exactly one cell. */
export function tick(s: SnakeState, rand: () => number): void {
  if (s.phase !== "running") return;

  const d = DELTA[s.dir];
  const head = s.body[0];
  const next: Point = { x: head.x + d.x, y: head.y + d.y };
  s.movedDir = s.dir;

  // Walls are solid. Wrapping would make the board meaningless.
  if (next.x < 0 || next.y < 0 || next.x >= COLS || next.y >= ROWS) {
    s.phase = "over";
    return;
  }

  // The tail cell is about to be vacated, so running into it is legal —
  // unless the snake is mid-growth, in which case the tail stays put.
  const ignoreTail = s.grow === 0;
  const hitSelf = s.body.some(
    (p, i) => samePoint(p, next) && !(ignoreTail && i === s.body.length - 1),
  );
  if (hitSelf) {
    s.phase = "over";
    return;
  }

  s.body.unshift(next);

  if (samePoint(next, s.food)) {
    s.score += 10;
    s.grow += 1;
    s.intervalMs = Math.max(MIN_INTERVAL_MS, s.intervalMs - SPEEDUP_MS);
    s.food = placeFood(s.body, rand);
  }

  if (s.grow > 0) {
    s.grow -= 1;
  } else {
    s.body.pop();
  }
}

/** How fast it feels, in words, for the panel that says so. */
export function speedLabel(intervalMs: number): string {
  if (intervalMs > 115) return "SLOW";
  if (intervalMs > 95) return "MEDIUM";
  if (intervalMs > 78) return "FAST";
  return "BLISTERING";
}

/** 0 to 1, for the little bar chart beside the label. */
export function speedFraction(intervalMs: number): number {
  const span = START_INTERVAL_MS - MIN_INTERVAL_MS;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (START_INTERVAL_MS - intervalMs) / span));
}

export function start(rand: () => number): SnakeState {
  const fresh = initialState(rand);
  fresh.phase = "running";
  return fresh;
}
