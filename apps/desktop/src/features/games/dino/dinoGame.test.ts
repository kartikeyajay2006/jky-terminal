import { describe, expect, it } from "vitest";
import {
  ACCELERATION,
  airborne,
  CACTUS_SHAPES,
  DINO_X,
  INVULNERABLE_MS,
  MAX_SPEED,
  START_LIVES,
  START_SPEED,
  dinoHeight,
  initialState,
  jump,
  makeRandom,
  overlaps,
  setDucking,
  spawnGap,
  start,
  step,
  type DinoState,
} from "./dinoGame";

const rand = () => makeRandom(42)();

/** A running game with no obstacles, so a test can isolate one rule. */
function running(): DinoState {
  const s = initialState();
  s.phase = "running";
  // Far enough away that nothing spawns during a short test.
  s.nextSpawn = 10_000;
  return s;
}

/** Run the game for a while at a steady frame rate. */
function run(s: DinoState, ms: number, r: () => number = rand, frame = 16): void {
  for (let t = 0; t < ms; t += frame) step(s, frame, r);
}

describe("starting out", () => {
  it("waits to be started rather than running immediately", () => {
    expect(initialState().phase).toBe("ready");
  });

  it("does nothing at all until it is running", () => {
    const s = initialState();
    step(s, 500, rand);
    expect(s.distance).toBe(0);
    expect(s.score).toBe(0);
  });

  it("begins with three lives", () => {
    expect(initialState().lives).toBe(START_LIVES);
  });

  it("starts on the ground", () => {
    expect(airborne(initialState())).toBe(false);
  });

  it("clears the board when started again after a game over", () => {
    const s = running();
    s.score = 900;
    s.lives = 1;
    s.phase = "over";
    const fresh = start(s);
    expect(fresh.phase).toBe("running");
    expect(fresh.score).toBe(0);
    expect(fresh.lives).toBe(START_LIVES);
    expect(fresh.cacti).toEqual([]);
  });
});

describe("jumping", () => {
  it("leaves the ground", () => {
    const s = running();
    jump(s);
    step(s, 16, rand);
    expect(airborne(s)).toBe(true);
  });

  it("comes back down on its own", () => {
    const s = running();
    jump(s);
    run(s, 3000);
    expect(s.y).toBe(0);
    expect(airborne(s)).toBe(false);
  });

  it("rises and then falls, rather than climbing forever", () => {
    const s = running();
    jump(s);
    let peak = 0;
    for (let i = 0; i < 200; i += 1) {
      step(s, 16, rand);
      peak = Math.max(peak, s.y);
    }
    expect(peak).toBeGreaterThan(4);
    expect(s.y).toBeLessThan(peak);
  });

  it("refuses a second jump in mid-air", () => {
    // Correcting a bad jump mid-flight would remove the only decision the
    // game asks you to make.
    const s = running();
    jump(s);
    run(s, 200);
    const height = s.y;
    const rising = s.vy;
    jump(s);
    expect(s.vy).toBe(rising);
    expect(s.y).toBe(height);
  });

  it("ignores a jump before the game has started", () => {
    const s = initialState();
    jump(s);
    expect(s.vy).toBe(0);
  });
});

describe("ducking", () => {
  it("makes the dino shorter", () => {
    const s = running();
    expect(dinoHeight(s)).toBeGreaterThan(0);
    setDucking(s, true);
    expect(dinoHeight(s)).toBeLessThan(dinoHeight({ ...s, ducking: false }));
  });

  it("cannot be used in mid-air to fall through a gap", () => {
    const s = running();
    jump(s);
    step(s, 16, rand);
    setDucking(s, true);
    expect(s.ducking).toBe(false);
  });

  it("is cancelled by jumping", () => {
    const s = running();
    setDucking(s, true);
    jump(s);
    expect(s.ducking).toBe(false);
  });
});

describe("speed", () => {
  it("climbs as the run goes on", () => {
    const s = running();
    const before = s.speed;
    run(s, 4000);
    expect(s.speed).toBeGreaterThan(before);
  });

  it("climbs at the stated rate", () => {
    const s = running();
    run(s, 10_000);
    expect(s.speed).toBeCloseTo(START_SPEED + 10 * ACCELERATION, 1);
  });

  it("stops climbing at the cap, so the game stays playable", () => {
    // Past the cap the gap between seeing a cactus and needing to have
    // already jumped is shorter than a person's reaction time.
    const s = running();
    run(s, 400_000, rand, 50);
    expect(s.speed).toBe(MAX_SPEED);
  });
});

describe("scoring", () => {
  it("climbs with distance travelled", () => {
    const s = running();
    run(s, 2000);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBe(Math.floor(s.distance / 2));
  });

  it("scores faster later, because the world is moving faster", () => {
    const early = running();
    run(early, 2000);
    const earlyGain = early.score;

    const late = running();
    run(late, 40_000);
    const before = late.score;
    run(late, 2000);
    expect(late.score - before).toBeGreaterThan(earlyGain / 2);
  });
});

describe("cacti", () => {
  it("spawns them as the world scrolls", () => {
    const s = running();
    s.nextSpawn = 1;
    run(s, 2000);
    expect(s.cacti.length).toBeGreaterThan(0);
  });

  it("moves them towards the dino", () => {
    const s = running();
    s.cacti.push({ x: 80, w: 3, h: 3, passed: false });
    const before = s.cacti[0].x;
    run(s, 500);
    expect(s.cacti[0].x).toBeLessThan(before);
  });

  it("forgets one that has gone off the left edge", () => {
    const s = running();
    s.cacti.push({ x: 2, w: 3, h: 3, passed: false });
    run(s, 2000);
    expect(s.cacti).toHaveLength(0);
  });

  it("leaves a gap wide enough to be jumped, at any speed", () => {
    // A gap that is generous at the starting speed is impossible at the cap,
    // where the dino would still be airborne from the previous cactus.
    const r = makeRandom(3);
    for (const speed of [START_SPEED, MAX_SPEED]) {
      for (let i = 0; i < 50; i += 1) {
        expect(spawnGap(speed, r)).toBeGreaterThan(24);
      }
    }
  });

  it("only offers shapes that are actually jumpable", () => {
    for (const shape of CACTUS_SHAPES) {
      expect(shape.h).toBeLessThan(7);
      expect(shape.w).toBeGreaterThan(0);
    }
  });
});

describe("collisions", () => {
  it("says two separated boxes do not overlap", () => {
    expect(overlaps(0, 2, 0, 2, 5, 2, 0, 2)).toBe(false);
  });

  it("says two boxes sharing space do overlap", () => {
    expect(overlaps(0, 4, 0, 4, 2, 4, 2, 4)).toBe(true);
  });

  it("says boxes in the same column but different rows do not", () => {
    // The case that makes jumping work at all.
    expect(overlaps(0, 4, 10, 4, 0, 4, 0, 4)).toBe(false);
  });

  it("costs a life when the dino runs into a cactus", () => {
    const s = running();
    s.cacti.push({ x: DINO_X, w: 4, h: 4, passed: false });
    step(s, 16, rand);
    expect(s.lives).toBe(START_LIVES - 1);
  });

  it("does not cost every life to a single cactus", () => {
    // Without the grace period one cactus takes all three lives in three
    // consecutive frames, because the dino is still standing inside it.
    const s = running();
    s.cacti.push({ x: DINO_X, w: 4, h: 4, passed: false });
    run(s, 200);
    expect(s.lives).toBe(START_LIVES - 1);
  });

  it("can be hit again once the grace period has passed", () => {
    const s = running();
    s.cacti.push({ x: DINO_X, w: 4, h: 40, passed: false });
    step(s, 16, rand);
    expect(s.lives).toBe(START_LIVES - 1);

    s.invulnerableMs = 0;
    s.cacti[0].x = DINO_X;
    step(s, 16, rand);
    expect(s.lives).toBe(START_LIVES - 2);
  });

  it("grants a grace period of the stated length, counting from the hit", () => {
    const s = running();
    s.cacti.push({ x: DINO_X, w: 4, h: 4, passed: false });
    step(s, 16, rand);
    // The full duration, not the duration less this frame: the clock starts
    // when the dino is hit, part-way through the frame's work.
    expect(s.invulnerableMs).toBe(INVULNERABLE_MS);

    step(s, 16, rand);
    expect(s.invulnerableMs).toBe(INVULNERABLE_MS - 16);
  });

  it("ends the game when the last life is gone", () => {
    const s = running();
    s.lives = 1;
    s.cacti.push({ x: DINO_X, w: 4, h: 4, passed: false });
    step(s, 16, rand);
    expect(s.lives).toBe(0);
    expect(s.phase).toBe("over");
  });

  it("a jumped cactus costs nothing", () => {
    const s = running();
    // Well above anything in the shape table.
    s.y = 9;
    s.cacti.push({ x: DINO_X, w: 4, h: 4, passed: false });
    step(s, 16, rand);
    expect(s.lives).toBe(START_LIVES);
  });

  it("stops the world once the game is over", () => {
    const s = running();
    s.phase = "over";
    const distance = s.distance;
    step(s, 500, rand);
    expect(s.distance).toBe(distance);
  });
});

describe("the sky", () => {
  it("drifts clouds slower than the ground, which reads as distance", () => {
    const s = running();
    const cloudBefore = s.clouds[0].x;
    s.cacti.push({ x: 90, w: 3, h: 3, passed: false });
    const cactusBefore = s.cacti[0].x;
    run(s, 500);

    const cloudMoved = cloudBefore - s.clouds[0].x;
    const cactusMoved = cactusBefore - s.cacti[0].x;
    expect(cloudMoved).toBeGreaterThan(0);
    expect(cloudMoved).toBeLessThan(cactusMoved);
  });

  it("brings a cloud back round rather than running out of sky", () => {
    const s = running();
    run(s, 30_000);
    for (const c of s.clouds) expect(c.x).toBeGreaterThan(-13);
  });
});

describe("the generator", () => {
  it("gives the same run for the same seed", () => {
    const a = makeRandom(99);
    const b = makeRandom(99);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it("stays between zero and one", () => {
    const r = makeRandom(5);
    for (let i = 0; i < 500; i += 1) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("does not get stuck on one value", () => {
    const r = makeRandom(1);
    const seen = new Set(Array.from({ length: 50 }, () => r()));
    expect(seen.size).toBeGreaterThan(40);
  });
});
