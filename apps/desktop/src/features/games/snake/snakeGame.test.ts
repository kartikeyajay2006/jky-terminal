import { describe, expect, it } from "vitest";
import {
  COLS,
  MIN_INTERVAL_MS,
  OPPOSITE,
  ROWS,
  START_INTERVAL_MS,
  initialState,
  makeRandom,
  placeFood,
  samePoint,
  speedFraction,
  speedLabel,
  start,
  tick,
  turn,
  type SnakeState,
} from "./snakeGame";

const rand = makeRandom(13);

function running(): SnakeState {
  const s = initialState(makeRandom(3));
  s.phase = "running";
  return s;
}

/** Put the food where it cannot be reached by accident during a test. */
function foodAway(s: SnakeState): void {
  s.food = { x: COLS - 1, y: ROWS - 1 };
}

describe("starting out", () => {
  it("waits to be started", () => {
    expect(initialState().phase).toBe("ready");
  });

  it("does nothing until it is running", () => {
    const s = initialState();
    const before = s.body.map((p) => ({ ...p }));
    tick(s, rand);
    expect(s.body).toEqual(before);
  });

  it("starts with a snake of more than one segment", () => {
    expect(initialState().body.length).toBeGreaterThan(1);
  });

  it("starts inside the board", () => {
    for (const p of initialState().body) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(COLS);
      expect(p.y).toBeLessThan(ROWS);
    }
  });

  it("puts food somewhere the snake is not", () => {
    const s = initialState();
    expect(s.body.some((p) => samePoint(p, s.food))).toBe(false);
  });

  it("clears the board when started again", () => {
    const fresh = start(makeRandom(2));
    expect(fresh.phase).toBe("running");
    expect(fresh.score).toBe(0);
    expect(fresh.intervalMs).toBe(START_INTERVAL_MS);
  });
});

describe("moving", () => {
  it("advances one cell per tick", () => {
    const s = running();
    foodAway(s);
    const head = { ...s.body[0] };
    tick(s, rand);
    expect(s.body[0]).toEqual({ x: head.x + 1, y: head.y });
  });

  it("keeps its length when it has not eaten", () => {
    const s = running();
    foodAway(s);
    const length = s.body.length;
    tick(s, rand);
    expect(s.body).toHaveLength(length);
  });

  it("turns where it is told", () => {
    const s = running();
    foodAway(s);
    turn(s, "up");
    const head = { ...s.body[0] };
    tick(s, rand);
    expect(s.body[0]).toEqual({ x: head.x, y: head.y - 1 });
  });

  it("refuses to double back on itself", () => {
    // A slip, not a death sentence: pressing left while going right is
    // ignored rather than fatal.
    const s = running();
    foodAway(s);
    turn(s, "left");
    expect(s.dir).toBe("right");
  });

  it("cannot be reversed by two quick turns inside one tick", () => {
    // The turn that has to be refused is the one back into the neck. Going
    // right, a player who presses up and then left within a single tick would
    // — if the check looked at the pending direction rather than the one
    // actually travelled — be allowed to turn straight back into themselves,
    // having never moved out of the way.
    const s = running();
    foodAway(s);
    turn(s, "up");
    expect(s.dir).toBe("up");

    turn(s, "left");
    expect(s.dir).toBe("up");
  });

  it("still allows a genuine cornering turn made in the same tick", () => {
    // Guarding against reversal must not cost the player a legal corner:
    // right then up then down is two ordinary turns, not a reversal.
    const s = running();
    foodAway(s);
    turn(s, "up");
    turn(s, "down");
    expect(s.dir).toBe("down");
  });

  it("ignores a turn before the game is running", () => {
    const s = initialState();
    turn(s, "up");
    expect(s.dir).toBe("right");
  });

  it("pairs every direction with its opposite", () => {
    for (const [dir, opp] of Object.entries(OPPOSITE)) {
      expect(OPPOSITE[opp]).toBe(dir);
    }
  });
});

describe("walls", () => {
  it("ends the game at the right edge", () => {
    const s = running();
    foodAway(s);
    s.body = [{ x: COLS - 1, y: 5 }];
    tick(s, rand);
    expect(s.phase).toBe("over");
  });

  it("ends the game at the left edge", () => {
    const s = running();
    foodAway(s);
    s.body = [{ x: 0, y: 5 }];
    s.dir = "left";
    s.movedDir = "left";
    tick(s, rand);
    expect(s.phase).toBe("over");
  });

  it("ends the game at the top", () => {
    const s = running();
    foodAway(s);
    s.body = [{ x: 5, y: 0 }];
    s.dir = "up";
    s.movedDir = "up";
    tick(s, rand);
    expect(s.phase).toBe("over");
  });

  it("ends the game at the bottom", () => {
    const s = running();
    foodAway(s);
    s.body = [{ x: 5, y: ROWS - 1 }];
    s.dir = "down";
    s.movedDir = "down";
    tick(s, rand);
    expect(s.phase).toBe("over");
  });

  it("does not wrap around, which would make the board meaningless", () => {
    const s = running();
    foodAway(s);
    s.body = [{ x: COLS - 1, y: 5 }];
    tick(s, rand);
    expect(s.body[0].x).not.toBe(0);
  });
});

describe("eating itself", () => {
  it("ends the game on running into its own body", () => {
    const s = running();
    foodAway(s);
    // A tight square: the head turns into its own third segment.
    s.body = [
      { x: 5, y: 5 },
      { x: 4, y: 5 },
      { x: 4, y: 6 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
    ];
    s.dir = "down";
    s.movedDir = "right";
    tick(s, rand);
    expect(s.phase).toBe("over");
  });

  it("allows the head into the cell the tail is leaving", () => {
    // Legal in every version of this game, and it feels wrong when it is not.
    const s = running();
    foodAway(s);
    s.body = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 6 },
      { x: 6, y: 5 },
    ];
    s.dir = "right";
    s.movedDir = "up";
    s.grow = 0;
    tick(s, rand);
    expect(s.phase).toBe("running");
  });
});

describe("eating", () => {
  it("scores", () => {
    const s = running();
    s.food = { x: s.body[0].x + 1, y: s.body[0].y };
    tick(s, rand);
    expect(s.score).toBe(10);
  });

  it("grows the snake", () => {
    const s = running();
    const length = s.body.length;
    s.food = { x: s.body[0].x + 1, y: s.body[0].y };
    tick(s, rand);
    expect(s.body.length).toBe(length + 1);
  });

  it("moves the food somewhere else", () => {
    const s = running();
    const eaten = { x: s.body[0].x + 1, y: s.body[0].y };
    s.food = eaten;
    tick(s, rand);
    expect(samePoint(s.food, eaten)).toBe(false);
  });

  it("speeds the game up", () => {
    const s = running();
    const before = s.intervalMs;
    s.food = { x: s.body[0].x + 1, y: s.body[0].y };
    tick(s, rand);
    expect(s.intervalMs).toBeLessThan(before);
  });

  it("never speeds past the point where turns stop registering", () => {
    const s = running();
    for (let i = 0; i < 400; i += 1) {
      s.food = { x: s.body[0].x + 1, y: s.body[0].y };
      if (s.food.x >= COLS) break;
      tick(s, rand);
    }
    expect(s.intervalMs).toBeGreaterThanOrEqual(MIN_INTERVAL_MS);
  });
});

describe("placing food", () => {
  it("never lands on the snake", () => {
    const body = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
    ];
    const r = makeRandom(9);
    for (let i = 0; i < 200; i += 1) {
      const food = placeFood(body, r);
      expect(body.some((p) => samePoint(p, food))).toBe(false);
    }
  });

  it("lands inside the board", () => {
    const r = makeRandom(4);
    for (let i = 0; i < 200; i += 1) {
      const food = placeFood([], r);
      expect(food.x).toBeGreaterThanOrEqual(0);
      expect(food.y).toBeGreaterThanOrEqual(0);
      expect(food.x).toBeLessThan(COLS);
      expect(food.y).toBeLessThan(ROWS);
    }
  });

  it("returns something rather than spinning forever on a full board", () => {
    // The reason this walks the free cells instead of guessing repeatedly:
    // rejection sampling on a nearly full board can spin for thousands of
    // iterations inside a single frame.
    const full: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < ROWS; y += 1) {
      for (let x = 0; x < COLS; x += 1) full.push({ x, y });
    }
    expect(() => placeFood(full, makeRandom(1))).not.toThrow();
  });
});

describe("the speed readout", () => {
  it("reads as words, not milliseconds", () => {
    expect(speedLabel(START_INTERVAL_MS)).toBe("SLOW");
    expect(speedLabel(MIN_INTERVAL_MS)).toBe("BLISTERING");
  });

  it("gets faster-sounding as the interval shortens", () => {
    const labels = [130, 110, 90, 70].map(speedLabel);
    expect(new Set(labels).size).toBe(4);
  });

  it("reports a fraction between nothing and everything", () => {
    expect(speedFraction(START_INTERVAL_MS)).toBe(0);
    expect(speedFraction(MIN_INTERVAL_MS)).toBe(1);
    expect(speedFraction(0)).toBe(1);
    expect(speedFraction(9999)).toBe(0);
  });
});
