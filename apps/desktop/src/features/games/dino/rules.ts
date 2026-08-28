/**
 * Dino Run — the rules, with no React and no DOM in sight.
 *
 * Everything here is a pure function of state and a time step, which is what
 * makes the awkward parts testable: that the jump arc peaks and comes back
 * down, that speed climbs without ever making the game unplayable, that a
 * cactus is only a collision when the boxes actually overlap rather than
 * merely sharing a column.
 */

export const COLS = 96;
export const ROWS = 26;

/** The row the ground line sits on. Everything stands on top of it. */
export const GROUND_Y = 19;

/** How tall the dino is, in rows. */
export const DINO_H = 5;
/** How wide, in columns. */
export const DINO_W = 9;
/** Where it stands, horizontally. Fixed — the world moves, not the dino. */
export const DINO_X = 8;

/** Cells per second at the very start. */
export const START_SPEED = 22;
/**
 * The fastest the world is ever allowed to move.
 *
 * Found by playing rather than chosen: past roughly fifty cells a second the
 * gap between spotting a cactus and needing to have already jumped is shorter
 * than a person's reaction time, so the game stops being hard and starts
 * being unfair.
 */
export const MAX_SPEED = 46;
/** How much faster it gets per second survived. */
export const ACCELERATION = 0.55;

/** Upward cells per second at the moment of a jump. */
export const JUMP_VELOCITY = 34;
/** Downward cells per second squared. */
export const GRAVITY = 78;

export const START_LIVES = 3;

/**
 * How long the dino cannot be hit again after being hit.
 *
 * Without it, one cactus takes all three lives in three consecutive frames,
 * because the dino is still standing inside it on the next one.
 */
export const INVULNERABLE_MS = 1400;

export type Phase = "ready" | "running" | "over";

export interface Cactus {
  /** Left edge, in columns from the left of the board. Fractional. */
  x: number;
  w: number;
  h: number;
  /** Set once the dino has gone past, so a score is not counted twice. */
  passed: boolean;
}

export interface Cloud {
  x: number;
  y: number;
  /** Clouds drift slower than the ground, which reads as distance. */
  factor: number;
}

export interface DinoState {
  phase: Phase;
  /** Rows above the ground. 0 while standing. */
  y: number;
  vy: number;
  ducking: boolean;
  speed: number;
  distance: number;
  score: number;
  lives: number;
  invulnerableMs: number;
  cacti: Cactus[];
  clouds: Cloud[];
  /** Seconds since the run began, for the day/night cycle and the speed ramp. */
  elapsed: number;
  /** Columns until the next cactus is spawned. */
  nextSpawn: number;
  /** Advances with distance, so legs and wings animate at a sane rate. */
  frame: number;
}

/**
 * A tiny deterministic generator.
 *
 * `Math.random` would make every test that touches spawning a coin flip.
 * This is seeded, so a test can assert that a run produces a gap wide enough
 * to jump through and have that mean something.
 */
export function makeRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    // xorshift32 — small, fast, and more than random enough for cactus gaps.
    s ^= s << 13;
    s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

export function initialState(): DinoState {
  return {
    phase: "ready",
    y: 0,
    vy: 0,
    ducking: false,
    speed: START_SPEED,
    distance: 0,
    score: 0,
    lives: START_LIVES,
    invulnerableMs: 0,
    cacti: [],
    clouds: [
      { x: 20, y: 3, factor: 0.25 },
      { x: 52, y: 5, factor: 0.18 },
      { x: 80, y: 2, factor: 0.32 },
    ],
    elapsed: 0,
    nextSpawn: 40,
    frame: 0,
  };
}

/** Is the dino off the ground right now? */
export function airborne(s: DinoState): boolean {
  return s.y > 0.001;
}

/** Start a jump, if the dino is in a position to start one. */
export function jump(s: DinoState): void {
  if (s.phase !== "running") return;
  // No double jump. Being able to correct a bad jump mid-air removes the only
  // decision the game asks you to make.
  if (airborne(s)) return;
  s.vy = JUMP_VELOCITY;
  s.ducking = false;
}

export function setDucking(s: DinoState, ducking: boolean): void {
  // Ducking in mid-air would let a player fall faster and cheat a gap.
  if (ducking && airborne(s)) return;
  s.ducking = ducking;
}

/** How tall the dino's collision box is right now. */
export function dinoHeight(s: DinoState): number {
  return s.ducking ? 3 : DINO_H;
}

/** Do two boxes on the ground plane overlap? */
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

/** The cactus shapes that can appear, small to large. */
export const CACTUS_SHAPES: ReadonlyArray<{ w: number; h: number }> = [
  { w: 3, h: 3 },
  { w: 3, h: 4 },
  { w: 5, h: 4 },
  { w: 7, h: 3 },
  { w: 4, h: 5 },
];

/**
 * The gap before the next cactus, in columns.
 *
 * Scaled by speed, because a fixed gap that is generous at twenty-two cells a
 * second is impossible at forty-six — the dino would still be in the air from
 * the last one. The floor is what keeps the game honest at top speed.
 */
export function spawnGap(speed: number, rand: () => number): number {
  const base = 26 + (speed / START_SPEED) * 12;
  return base + rand() * 34;
}

/**
 * Advance the world by `dtMs`.
 *
 * Mutates in place. That is unusual for this codebase and deliberate here:
 * this runs sixty times a second, and rebuilding the state object plus its
 * cactus array every frame is exactly the allocation churn the grid renderer
 * goes out of its way to avoid.
 */
export function step(s: DinoState, dtMs: number, rand: () => number): void {
  if (s.phase !== "running") return;

  const dt = dtMs / 1000;
  s.elapsed += dt;

  s.speed = Math.min(MAX_SPEED, START_SPEED + s.elapsed * ACCELERATION);

  const travelled = s.speed * dt;
  s.distance += travelled;
  s.frame += travelled;

  // Ten points a second at the starting speed, and more as it climbs, so the
  // score reflects how far you got rather than how long you sat there.
  s.score = Math.floor(s.distance / 2);

  if (s.invulnerableMs > 0) s.invulnerableMs = Math.max(0, s.invulnerableMs - dtMs);

  // --- the jump arc ---
  if (airborne(s) || s.vy > 0) {
    s.vy -= GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y <= 0) {
      s.y = 0;
      s.vy = 0;
    }
  }

  // --- the world moves left ---
  for (const c of s.cacti) c.x -= travelled;
  for (const cloud of s.clouds) {
    cloud.x -= travelled * cloud.factor;
    if (cloud.x < -12) {
      cloud.x = COLS + rand() * 30;
      cloud.y = 2 + Math.floor(rand() * 5);
    }
  }

  // Anything fully off the left edge is gone. Splice rather than filter, to
  // keep the array identity stable and avoid a fresh allocation each frame.
  for (let i = s.cacti.length - 1; i >= 0; i -= 1) {
    if (s.cacti[i].x + s.cacti[i].w < 0) s.cacti.splice(i, 1);
  }

  // --- spawning ---
  s.nextSpawn -= travelled;
  if (s.nextSpawn <= 0) {
    const shape = CACTUS_SHAPES[Math.floor(rand() * CACTUS_SHAPES.length)];
    s.cacti.push({ x: COLS + 2, w: shape.w, h: shape.h, passed: false });
    s.nextSpawn = spawnGap(s.speed, rand);
  }

  // --- collisions ---
  const dh = dinoHeight(s);
  for (const c of s.cacti) {
    if (!c.passed && c.x + c.w < DINO_X) c.passed = true;
    if (s.invulnerableMs > 0) continue;
    // The box is pulled in by a column on each side. A collision that
    // triggers on the dino's outermost pixel of tail feels like a cheat even
    // when it is technically correct.
    if (overlaps(DINO_X + 1, DINO_W - 2, s.y, dh, c.x, c.w, 0, c.h)) {
      s.lives -= 1;
      s.invulnerableMs = INVULNERABLE_MS;
      if (s.lives <= 0) {
        s.lives = 0;
        s.phase = "over";
      }
      break;
    }
  }
}

/** Begin, from the ready screen or after a game over. */
export function start(s: DinoState): DinoState {
  const fresh = initialState();
  fresh.phase = "running";
  fresh.clouds = s.clouds.map((c) => ({ ...c }));
  return fresh;
}
