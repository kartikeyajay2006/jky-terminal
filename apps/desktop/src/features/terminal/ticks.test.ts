import { describe, expect, it } from "vitest";
import {
  heightOf,
  longestOf,
  MAX_TICK,
  MAX_TICKS,
  MIN_TICK,
  pushTick,
  toneOf,
  tookText,
  type Tick,
} from "./ticks";

const tick = (over: Partial<Tick> = {}): Tick => ({
  id: "t1",
  command: "ls",
  code: 0,
  took: 100,
  line: 1,
  at: 0,
  ...over,
});

describe("how a command is coloured", () => {
  it("marks one that worked and one that did not", () => {
    expect(toneOf(tick({ code: 0 }))).toBe("ok");
    expect(toneOf(tick({ code: 1 }))).toBe("failed");
  });

  it("marks one still going as running, whatever its status says", () => {
    expect(toneOf(tick({ took: null, code: null }))).toBe("running");
  });

  it("does not cry wolf over a shell that reported no status", () => {
    // Not a shell reporting success, but not one reporting failure either —
    // red here would be red on every command under a shell this cannot hook.
    expect(toneOf(tick({ code: null, took: 50 }))).toBe("ok");
  });
});

describe("how tall a command is drawn", () => {
  it("keeps the shortest command clickable", () => {
    // Four milliseconds still happened.
    expect(heightOf(4, 240_000)).toBeGreaterThanOrEqual(MIN_TICK);
  });

  it("never lets one command become the whole strip", () => {
    expect(heightOf(240_000, 240_000)).toBeLessThanOrEqual(MAX_TICK);
  });

  it("leaves the short ones readable beside a very long one", () => {
    // Drawn in proportion, a hundred sub-second commands beside one
    // four-minute build are invisible. The root is what keeps them.
    const short = heightOf(200, 240_000);
    expect(short).toBeGreaterThan(MIN_TICK + 2);
    expect(short).toBeLessThan(heightOf(240_000, 240_000));
  });

  it("keeps the longer of two commands the taller", () => {
    expect(heightOf(5_000, 60_000)).toBeGreaterThan(heightOf(500, 60_000));
  });

  it("draws one still running at full height, because it is still going", () => {
    expect(heightOf(null, 1000)).toBe(MAX_TICK);
  });

  it("never returns nonsense for nonsense", () => {
    for (const took of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const height = heightOf(took, 1000);
      expect(Number.isFinite(height), String(took)).toBe(true);
      expect(height).toBeGreaterThanOrEqual(MIN_TICK);
      expect(height).toBeLessThanOrEqual(MAX_TICK);
    }
  });

  it("copes with a session whose longest command is unknown", () => {
    expect(heightOf(100, 0)).toBe(MAX_TICK);
  });
});

describe("the session", () => {
  it("scales against its longest command, ignoring the unfinished", () => {
    expect(longestOf([tick({ took: 100 }), tick({ took: 900 }), tick({ took: null })])).toBe(900);
  });

  it("has no longest command when it has none at all", () => {
    expect(longestOf([])).toBe(0);
  });

  it("remembers a session, not a log", () => {
    let ticks: Tick[] = [];
    for (let i = 0; i < MAX_TICKS * 2; i += 1) ticks = pushTick(ticks, tick({ id: `t${i}` }));

    expect(ticks).toHaveLength(MAX_TICKS);
    expect(ticks[ticks.length - 1].id).toBe(`t${MAX_TICKS * 2 - 1}`);
  });
});

describe("how long it took", () => {
  it("uses the roughest unit that is still true", () => {
    expect(tookText(4)).toBe("4ms");
    expect(tookText(1500)).toBe("1.5s");
    expect(tookText(245_000)).toBe("4m 5s");
  });

  it("never says a command took no time at all", () => {
    expect(tookText(0.2)).toBe("1ms");
  });

  it("says plainly when one has not finished", () => {
    expect(tookText(null)).toBe("still running");
  });
});
