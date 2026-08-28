import { describe, expect, it } from "vitest";
import {
  countdownDone,
  countdownPulse,
  countdownWord,
  STEPS,
  TICK_MS,
  TOTAL_MS,
} from "./countdown";

describe("the countdown", () => {
  it("counts three, two, one, go", () => {
    expect(STEPS).toEqual(["3", "2", "1", "GO"]);
  });

  it("shows each word in turn", () => {
    expect(countdownWord(0)).toBe("3");
    expect(countdownWord(TICK_MS)).toBe("2");
    expect(countdownWord(TICK_MS * 2)).toBe("1");
    expect(countdownWord(TICK_MS * 3)).toBe("GO");
  });

  it("holds a word for its whole tick", () => {
    expect(countdownWord(TICK_MS - 1)).toBe("3");
    expect(countdownWord(TICK_MS * 2 - 1)).toBe("2");
  });

  it("is over once the last word has had its turn", () => {
    expect(countdownWord(TOTAL_MS)).toBeNull();
    expect(countdownWord(TOTAL_MS + 5000)).toBeNull();
  });

  it("says when it is done", () => {
    expect(countdownDone(0)).toBe(false);
    expect(countdownDone(TOTAL_MS - 1)).toBe(false);
    expect(countdownDone(TOTAL_MS)).toBe(true);
  });

  it("survives a negative elapsed time rather than showing nothing", () => {
    // A frame clock that hands back a small negative on the first tick would
    // otherwise skip straight past the first number.
    expect(countdownWord(-5)).toBe("3");
    expect(countdownDone(-5)).toBe(false);
  });

  it("is short enough not to be a wait, long enough to be read", () => {
    expect(TOTAL_MS).toBeGreaterThan(1200);
    expect(TOTAL_MS).toBeLessThan(2600);
  });
});

describe("the pulse", () => {
  it("starts full and falls away across a tick", () => {
    expect(countdownPulse(0)).toBe(1);
    expect(countdownPulse(TICK_MS * 0.5)).toBeCloseTo(0.5, 2);
  });

  it("resets with each new word, so every number swells", () => {
    expect(countdownPulse(TICK_MS)).toBe(1);
    expect(countdownPulse(TICK_MS * 2)).toBe(1);
  });

  it("stays between nothing and everything", () => {
    for (let t = -100; t < TOTAL_MS + 500; t += 37) {
      const p = countdownPulse(t);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});
