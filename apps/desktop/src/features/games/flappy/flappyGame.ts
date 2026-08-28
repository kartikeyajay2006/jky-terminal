/**
 * Flappy Bird — the rules.
 *
 * The whole game is one number fighting gravity, so the numbers below are
 * the game. They were tuned by playing rather than derived: the gap has to be
 * wide enough that a clean flap clears it and narrow enough that a lazy one
 * does not.
 */

export const COLS = 88;
export const ROWS = 28;

/** The rows the world occupies, between the sky and the ground strip. */
export const SKY_TOP = 1;
export const GROUND_Y = 25;

/** The bird never moves horizontally. The world moves past it.  */
export const BIRD_X = 16;
export const BIRD_W = 4;
export const BIRD_H = 2;

export const GRAVITY = 62;
export const FLAP_VELOCITY = 21;
/** Falling any faster than this reads as a stone, not a bird. */
export const MAX_FALL_SPEED = 38;

export const START_SPEED = 17;
export const MAX_SPEED = 30;
export const ACCELERATION = 0.32;

/** How wide a pipe is, in columns. */
export const PIPE_W = 8;
/** The vertical hole, at the start. */
export const START_GAP = 9;
/**
 * The tightest the gap ever gets.
 *
 * Six rows is a little over twice the bird's height. Below that a perfect
 * flap still clips the lip, which is the point at which a hard game becomes
 * a broken one.
 */
export const MIN_GAP = 6;
export const GAP_TIGHTEN = 0.09;

/** Columns between one pipe and the next. */
export const START_SPACING = 30;
export const MIN_SPACING = 21;

export type Phase = "ready" | "running" | "over";

export interface Pipe {
  x: number;
  /** The row the hole starts at. */
  gapTop: number;
  gapHeight: number;
  passed: boolean;
}

export interface Building {
  x: number;
  w: number;
  h: number;
}

export interface FlappyState {
  phase: Phase;
  /** The bird's top row. Fractional between cells. */
  y: number;
  vy: number;
  pipes: Pipe[];
  buildings: Building[];
  clouds: Array<{ x: number; y: number }>;
  score: number;
  speed: number;
  gap: number;
  elapsed: number;
  /** Columns until the next pipe. */
  nextSpawn: number;
  /** Counts up while flapping, so the wing has something to animate on. */
  flapMs: number;
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

/** A skyline, generated once and scrolled slowly behind everything. */
export function makeSkyline(rand: () => number): Building[] {
  const out: Building[] = [];
  let x = 0;
  while (x < COLS + 30) {
    const w = 4 + Math.floor(rand() * 6);
    const h = 3 + Math.floor(rand() * 7);
    out.push({ x, w, h });
    x += w + 1 + Math.floor(rand() * 2);
  }
  return out;
}

export function initialState(rand: () => number = makeRandom(11)): FlappyState {
  return {
    phase: "ready",
    y: 11,
    vy: 0,
    pipes: [],
    buildings: makeSkyline(rand),
    clouds: [
      { x: 14, y: 3 },
      { x: 46, y: 5 },
      { x: 72, y: 2 },
    ],
    score: 0,
    speed: START_SPEED,
    gap: START_GAP,
    elapsed: 0,
    nextSpawn: 26,
    flapMs: 0,
  };
}

export function flap(s: FlappyState): void {
  if (s.phase !== "running") return;
  s.vy = -FLAP_VELOCITY;
  s.flapMs = 220;
}

/** Where a pipe's hole should start, keeping it clear of sky and ground. */
export function gapTopFor(gapHeight: number, rand: () => number): number {
  const highest = SKY_TOP + 2;
  const lowest = GROUND_Y - gapHeight - 2;
  if (lowest <= highest) return highest;
  return highest + Math.floor(rand() * (lowest - highest + 1));
}

export function overlaps(
  ax: number,
  aw: number,
  ay: number,
  ah: number,
  bx: number,
  bw: number,
  by: number,
  bh: number,
): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Advance the world. Mutates in place, for the same reason Dino Run does. */
export function step(s: FlappyState, dtMs: number, rand: () => number): void {
  if (s.phase !== "running") return;

  const dt = dtMs / 1000;
  s.elapsed += dt;
  if (s.flapMs > 0) s.flapMs = Math.max(0, s.flapMs - dtMs);

  s.speed = Math.min(MAX_SPEED, START_SPEED + s.elapsed * ACCELERATION);
  s.gap = Math.max(MIN_GAP, START_GAP - s.elapsed * GAP_TIGHTEN);

  s.vy = Math.min(MAX_FALL_SPEED, s.vy + GRAVITY * dt);
  s.y += s.vy * dt;

  // The ceiling is solid but not fatal — being pinned to the top is punishment
  // enough, and killing someone for touching the sky reads as a bug.
  if (s.y < SKY_TOP) {
    s.y = SKY_TOP;
    s.vy = 0;
  }

  const travelled = s.speed * dt;
  for (const p of s.pipes) p.x -= travelled;
  for (const b of s.buildings) {
    b.x -= travelled * 0.12;
    if (b.x + b.w < 0) b.x += COLS + 30;
  }
  for (const c of s.clouds) {
    c.x -= travelled * 0.22;
    if (c.x < -10) {
      c.x = COLS + rand() * 24;
      c.y = 2 + Math.floor(rand() * 4);
    }
  }

  for (let i = s.pipes.length - 1; i >= 0; i -= 1) {
    if (s.pipes[i].x + PIPE_W < 0) s.pipes.splice(i, 1);
  }

  s.nextSpawn -= travelled;
  if (s.nextSpawn <= 0) {
    const gapHeight = Math.round(s.gap);
    s.pipes.push({
      x: COLS + 2,
      gapTop: gapTopFor(gapHeight, rand),
      gapHeight,
      passed: false,
    });
    const spacing = Math.max(MIN_SPACING, START_SPACING - s.elapsed * 0.25);
    s.nextSpawn = spacing;
  }

  // The ground is fatal.
  if (s.y + BIRD_H >= GROUND_Y) {
    s.y = GROUND_Y - BIRD_H;
    s.phase = "over";
    return;
  }

  for (const p of s.pipes) {
    if (!p.passed && p.x + PIPE_W < BIRD_X) {
      p.passed = true;
      s.score += 1;
    }
    const hitsTop = overlaps(BIRD_X, BIRD_W, s.y, BIRD_H, p.x, PIPE_W, 0, p.gapTop);
    const hitsBottom = overlaps(
      BIRD_X,
      BIRD_W,
      s.y,
      BIRD_H,
      p.x,
      PIPE_W,
      p.gapTop + p.gapHeight,
      ROWS,
    );
    if (hitsTop || hitsBottom) {
      s.phase = "over";
      return;
    }
  }
}

export function start(s: FlappyState): FlappyState {
  const fresh = initialState();
  fresh.phase = "running";
  fresh.buildings = s.buildings.map((b) => ({ ...b }));
  // A flap on the first frame, so the bird rises out of the gate instead of
  // dropping while the player is still working out that it has begun.
  fresh.vy = -FLAP_VELOCITY * 0.6;
  return fresh;
}
