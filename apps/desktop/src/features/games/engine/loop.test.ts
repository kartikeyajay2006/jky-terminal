import { describe, expect, it } from "vitest";
import { drainSteps, MAX_STEP_MS } from "./loop";

describe("draining fixed steps", () => {
  it("owes nothing before a full step has passed", () => {
    expect(drainSteps(40, 100)).toEqual({ steps: 0, rest: 40 });
  });

  it("owes one step at exactly the interval", () => {
    expect(drainSteps(100, 100)).toEqual({ steps: 1, rest: 0 });
  });

  it("keeps the remainder, so time is not quietly lost", () => {
    const { steps, rest } = drainSteps(250, 100);
    expect(steps).toBe(2);
    expect(rest).toBe(50);
  });

  it("owes several steps when several intervals have passed", () => {
    expect(drainSteps(300, 100).steps).toBe(3);
  });

  it("caps the catch-up after a stall", () => {
    // Without this, one long stall makes a snake take twenty steps in a
    // single frame and run into itself somewhere the player never saw.
    expect(drainSteps(10_000, 100).steps).toBe(4);
  });

  it("drops the debt it could not repay rather than running fast forever", () => {
    // Carrying the overflow would leave the game owing time it can never
    // catch up on, so it would sprint from then on.
    expect(drainSteps(10_000, 100).rest).toBe(0);
  });

  it("respects a custom cap", () => {
    expect(drainSteps(10_000, 100, 2).steps).toBe(2);
  });

  it("refuses a zero or negative interval rather than dividing by it", () => {
    expect(drainSteps(500, 0)).toEqual({ steps: 0, rest: 0 });
    expect(drainSteps(500, -5)).toEqual({ steps: 0, rest: 0 });
  });
});

describe("the frame clamp", () => {
  it("is short enough that a returning tab does not teleport anything", () => {
    // Come back to a backgrounded tab a minute later and the first frame
    // would otherwise report sixty thousand milliseconds.
    expect(MAX_STEP_MS).toBeLessThanOrEqual(100);
  });

  it("is long enough to cover a slow frame on a slow machine", () => {
    expect(MAX_STEP_MS).toBeGreaterThanOrEqual(50);
  });
});
