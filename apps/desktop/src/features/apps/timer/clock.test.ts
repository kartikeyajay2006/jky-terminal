import { describe, expect, it } from "vitest";
import {
  elapsed,
  formatDuration,
  isFinished,
  newTimer,
  parseDuration,
  pause,
  remaining,
  reset,
  setDuration,
  start,
} from "./clock";

const MIN = 60_000;

describe("a timer's clock", () => {
  it("starts with nothing elapsed", () => {
    expect(elapsed(newTimer(5 * MIN), 1000)).toBe(0);
  });

  it("counts the time since it was started", () => {
    const t = start(newTimer(5 * MIN), 1000);
    expect(elapsed(t, 4000)).toBe(3000);
  });

  // The count comes from two timestamps rather than from a tick counter, so a
  // dropped frame, a backgrounded window or a slow machine cannot make the
  // timer disagree with the clock on the wall.
  it("does not drift when it is read irregularly", () => {
    const t = start(newTimer(10 * MIN), 0);
    expect(elapsed(t, 1)).toBe(1);
    expect(elapsed(t, 60_000)).toBe(60_000);
    expect(elapsed(t, 599_999)).toBe(599_999);
  });

  it("stops counting once paused", () => {
    const t = pause(start(newTimer(5 * MIN), 1000), 4000);
    expect(elapsed(t, 999_999)).toBe(3000);
  });

  it("resumes from where it was paused", () => {
    const paused = pause(start(newTimer(5 * MIN), 1000), 4000);
    const resumed = start(paused, 10_000);
    expect(elapsed(resumed, 12_000)).toBe(5000);
  });

  it("ignores a second start while already running", () => {
    const running = start(newTimer(5 * MIN), 1000);
    expect(start(running, 3000)).toEqual(running);
  });

  it("ignores a pause while already paused", () => {
    const idle = newTimer(5 * MIN);
    expect(pause(idle, 3000)).toEqual(idle);
  });

  it("puts the clock back to the start on reset, keeping the duration", () => {
    const t = reset(start(newTimer(5 * MIN), 1000));
    expect(elapsed(t, 999_999)).toBe(0);
    expect(t.durationMs).toBe(5 * MIN);
  });

  it("counts down rather than up", () => {
    const t = start(newTimer(5 * MIN), 0);
    expect(remaining(t, 60_000)).toBe(4 * MIN);
  });

  // Past zero the timer is finished, not negative: a countdown that keeps
  // going shows a number that is no longer counting down to anything.
  it("never reports less than no time left", () => {
    const t = start(newTimer(MIN), 0);
    expect(remaining(t, 999_999)).toBe(0);
  });

  it("is finished once the time is up", () => {
    const t = start(newTimer(MIN), 0);
    expect(isFinished(t, 59_999)).toBe(false);
    expect(isFinished(t, 60_000)).toBe(true);
  });

  it("is not finished before it has been started", () => {
    expect(isFinished(newTimer(MIN), 999_999)).toBe(false);
  });

  it("is never finished when no duration was set", () => {
    expect(isFinished(start(newTimer(0), 0), 999_999)).toBe(false);
  });

  it("takes a new duration and starts that afresh", () => {
    const t = setDuration(start(newTimer(MIN), 0), 3 * MIN);
    expect(t.durationMs).toBe(3 * MIN);
    expect(elapsed(t, 999_999)).toBe(0);
  });
});

describe("formatDuration", () => {
  it("shows minutes and seconds", () => {
    expect(formatDuration(0)).toBe("00:00");
    expect(formatDuration(65_000)).toBe("01:05");
    expect(formatDuration(9 * MIN)).toBe("09:00");
  });

  it("adds an hours field only once there are hours", () => {
    expect(formatDuration(59 * MIN)).toBe("59:00");
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });

  // A timer showing 00:00 for the last second of a run has already lied about
  // being finished, so a part-second counts as the second it is inside.
  it("rounds a part-second up, so it reads zero only when it is zero", () => {
    expect(formatDuration(1)).toBe("00:01");
    expect(formatDuration(999)).toBe("00:01");
    expect(formatDuration(1000)).toBe("00:01");
  });
});

describe("parseDuration", () => {
  it("reads a plain number as minutes", () => {
    expect(parseDuration("5")).toBe(5 * MIN);
  });

  it("reads minutes and seconds", () => {
    expect(parseDuration("2:30")).toBe(150_000);
  });

  it("reads hours, minutes and seconds", () => {
    expect(parseDuration("1:00:30")).toBe(3_630_000);
  });

  it("ignores surrounding space", () => {
    expect(parseDuration("  90  ")).toBe(90 * MIN);
  });

  it("refuses what it cannot read", () => {
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("1:2:3:4")).toBeNull();
  });

  it("refuses a seconds field that is not a real clock reading", () => {
    expect(parseDuration("1:75")).toBeNull();
  });

  it("refuses a negative duration", () => {
    expect(parseDuration("-5")).toBeNull();
  });
});
