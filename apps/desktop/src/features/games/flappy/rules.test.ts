import { describe, expect, it } from "vitest";
import {
  BIRD_H,
  BIRD_X,
  GROUND_Y,
  MAX_FALL_SPEED,
  MAX_SPEED,
  MIN_GAP,
  PIPE_W,
  SKY_TOP,
  START_GAP,
  START_SPEED,
  flap,
  gapTopFor,
  initialState,
  makeRandom,
  makeSkyline,
  overlaps,
  start,
  step,
  type FlappyState,
} from "./rules";

const rand = makeRandom(17);

function running(): FlappyState {
  const s = initialState(makeRandom(5));
  s.phase = "running";
  s.nextSpawn = 10_000;
  return s;
}

function run(s: FlappyState, ms: number, frame = 16): void {
  for (let t = 0; t < ms; t += frame) step(s, frame, rand);
}

/**
 * Run for a long stretch without letting the bird die.
 *
 * The ramps below take the better part of a minute of game time to reach
 * their caps, and a bird left alone hits the ground in under a second — so
 * a plain `run` would only ever prove that a dead game stops accelerating.
 */
function runAlive(s: FlappyState, ms: number, frame = 50): void {
  for (let t = 0; t < ms; t += frame) {
    s.y = 11;
    s.vy = 0;
    s.pipes.length = 0;
    s.nextSpawn = 10_000;
    step(s, frame, rand);
  }
}

describe("starting out", () => {
  it("waits to be started", () => {
    expect(initialState().phase).toBe("ready");
  });

  it("does nothing until it is running", () => {
    const s = initialState();
    const y = s.y;
    step(s, 500, rand);
    expect(s.y).toBe(y);
  });

  it("starts the bird in the air, not on the ground", () => {
    const s = initialState();
    expect(s.y).toBeGreaterThan(SKY_TOP);
    expect(s.y + BIRD_H).toBeLessThan(GROUND_Y);
  });

  it("gives the bird a lift on the first frame, so it does not just drop", () => {
    const fresh = start(initialState());
    expect(fresh.vy).toBeLessThan(0);
  });

  it("clears the score when started again", () => {
    const s = running();
    s.score = 40;
    expect(start(s).score).toBe(0);
  });
});

describe("gravity and flapping", () => {
  it("falls without input", () => {
    const s = running();
    const y = s.y;
    run(s, 300);
    expect(s.y).toBeGreaterThan(y);
  });

  it("rises after a flap", () => {
    const s = running();
    run(s, 200);
    const y = s.y;
    flap(s);
    step(s, 16, rand);
    expect(s.y).toBeLessThan(y);
  });

  it("never falls faster than a bird plausibly could", () => {
    const s = running();
    run(s, 5000);
    expect(s.vy).toBeLessThanOrEqual(MAX_FALL_SPEED);
  });

  it("ignores a flap before the game is running", () => {
    const s = initialState();
    flap(s);
    expect(s.vy).toBe(0);
  });

  it("stops at the ceiling without dying there", () => {
    // Being pinned to the top is punishment enough; killing someone for
    // touching the sky reads as a bug.
    const s = running();
    for (let i = 0; i < 40; i += 1) {
      flap(s);
      step(s, 16, rand);
    }
    expect(s.y).toBeGreaterThanOrEqual(SKY_TOP);
    expect(s.phase).toBe("running");
  });
});

describe("the ground", () => {
  it("ends the game", () => {
    const s = running();
    run(s, 8000);
    expect(s.phase).toBe("over");
  });

  it("leaves the bird resting on it rather than through it", () => {
    const s = running();
    run(s, 8000);
    expect(s.y + BIRD_H).toBeLessThanOrEqual(GROUND_Y);
  });
});

describe("pipes", () => {
  it("spawns them", () => {
    const s = running();
    s.nextSpawn = 1;
    step(s, 100, rand);
    expect(s.pipes.length).toBeGreaterThan(0);
  });

  it("moves them towards the bird", () => {
    const s = running();
    s.pipes.push({ x: 60, gapTop: 8, gapHeight: 9, passed: false });
    const before = s.pipes[0].x;
    run(s, 300);
    expect(s.pipes[0].x).toBeLessThan(before);
  });

  it("forgets one that has gone off the left edge", () => {
    const s = running();
    s.pipes.push({ x: 1, gapTop: 8, gapHeight: 9, passed: false });
    run(s, 3000);
    expect(s.pipes.some((p) => p.x + PIPE_W < 0)).toBe(false);
  });

  it("scores one for each pipe cleared", () => {
    const s = running();
    s.pipes.push({ x: BIRD_X - PIPE_W - 1, gapTop: 8, gapHeight: 9, passed: false });
    step(s, 16, rand);
    expect(s.score).toBe(1);
  });

  it("scores a pipe only once", () => {
    const s = running();
    s.pipes.push({ x: BIRD_X - PIPE_W - 1, gapTop: 8, gapHeight: 9, passed: false });
    run(s, 200);
    expect(s.score).toBe(1);
  });

  it("ends the game on the top half of a pipe", () => {
    const s = running();
    s.y = 2;
    s.pipes.push({ x: BIRD_X, gapTop: 12, gapHeight: 6, passed: false });
    step(s, 16, rand);
    expect(s.phase).toBe("over");
  });

  it("ends the game on the bottom half of a pipe", () => {
    const s = running();
    s.y = 18;
    s.pipes.push({ x: BIRD_X, gapTop: 3, gapHeight: 6, passed: false });
    step(s, 16, rand);
    expect(s.phase).toBe("over");
  });

  it("lets the bird through the gap unharmed", () => {
    const s = running();
    s.pipes.push({ x: BIRD_X, gapTop: 8, gapHeight: 9, passed: false });
    s.y = 11;
    s.vy = 0;
    step(s, 16, rand);
    expect(s.phase).toBe("running");
  });
});

describe("the gap", () => {
  it("always leaves room between the sky and the ground", () => {
    const r = makeRandom(21);
    for (let gap = MIN_GAP; gap <= START_GAP; gap += 1) {
      for (let i = 0; i < 50; i += 1) {
        const top = gapTopFor(gap, r);
        expect(top).toBeGreaterThanOrEqual(SKY_TOP);
        expect(top + gap).toBeLessThan(GROUND_Y);
      }
    }
  });

  it("tightens as the game goes on", () => {
    const s = running();
    const before = s.gap;
    run(s, 6000);
    expect(s.gap).toBeLessThan(before);
  });

  it("never tightens past what a clean flap can clear", () => {
    const s = running();
    runAlive(s, 120_000);
    expect(s.gap).toBe(MIN_GAP);
    expect(MIN_GAP).toBeGreaterThan(BIRD_H * 2);
  });
});

describe("speed", () => {
  it("climbs as the game goes on", () => {
    const s = running();
    const before = s.speed;
    run(s, 5000);
    expect(s.speed).toBeGreaterThan(before);
  });

  it("stops climbing at the cap", () => {
    const s = running();
    runAlive(s, 120_000);
    expect(s.speed).toBe(MAX_SPEED);
  });

  it("starts where it says it does", () => {
    expect(initialState().speed).toBe(START_SPEED);
  });
});

describe("the skyline", () => {
  it("covers the whole width and then some, so there is no bare edge", () => {
    const buildings = makeSkyline(makeRandom(8));
    const rightmost = Math.max(...buildings.map((b) => b.x + b.w));
    expect(rightmost).toBeGreaterThan(88);
  });

  it("scrolls slower than the pipes, which reads as distance", () => {
    const s = running();
    s.pipes.push({ x: 70, gapTop: 8, gapHeight: 9, passed: false });
    const pipeBefore = s.pipes[0].x;
    const buildingBefore = s.buildings[0].x;
    run(s, 400);

    const pipeMoved = pipeBefore - s.pipes[0].x;
    const buildingMoved = buildingBefore - s.buildings[0].x;
    expect(buildingMoved).toBeGreaterThan(0);
    expect(buildingMoved).toBeLessThan(pipeMoved);
  });

  it("wraps rather than running out of city", () => {
    const s = running();
    run(s, 40_000);
    for (const b of s.buildings) expect(b.x + b.w).toBeGreaterThan(-1);
  });
});

describe("box overlap", () => {
  it("says separated boxes do not overlap", () => {
    expect(overlaps(0, 2, 0, 2, 9, 2, 0, 2)).toBe(false);
  });

  it("says boxes sharing space do", () => {
    expect(overlaps(0, 4, 0, 4, 2, 4, 2, 4)).toBe(true);
  });

  it("says boxes in the same column at different heights do not", () => {
    expect(overlaps(0, 4, 0, 2, 0, 4, 10, 2)).toBe(false);
  });
});
