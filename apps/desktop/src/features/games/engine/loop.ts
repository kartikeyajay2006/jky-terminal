import { useEffect, useRef } from "react";

/**
 * The longest step a game is ever told about.
 *
 * Switch to another tab and `requestAnimationFrame` stops; come back a minute
 * later and the first frame would otherwise report sixty thousand
 * milliseconds, which teleports a bird through every pipe on the board. The
 * clamp turns "away for a minute" into "one slow frame", which is what a
 * player would expect.
 */
export const MAX_STEP_MS = 100;

/**
 * A frame loop that stops when the game is not being played.
 *
 * `step` is held in a ref so a component can pass a fresh closure every
 * render — which it will, since the closure reads state — without tearing
 * down and restarting the loop each time. Restarting per render is the bug
 * that makes a game visibly stutter whenever any HUD number changes.
 */
export function useGameLoop(running: boolean, step: (dtMs: number) => void): void {
  const stepRef = useRef(step);
  stepRef.current = step;

  useEffect(() => {
    if (!running) return;

    let frame = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(now - last, MAX_STEP_MS);
      last = now;
      stepRef.current(dt);
      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running]);
}

/**
 * Advance an accumulator, returning how many fixed steps are owed.
 *
 * Games whose rules are per-tick rather than per-second — a snake moves one
 * cell at a time, it does not move 0.4 of a cell — need their logic to run at
 * a fixed rate while the screen redraws at whatever rate it likes. Capping
 * the catch-up matters: without it, one long stall makes a snake take twenty
 * steps in a single frame and run into itself somewhere the player never saw.
 */
export function drainSteps(
  accumulatorMs: number,
  stepMs: number,
  maxSteps = 4,
): { steps: number; rest: number } {
  if (stepMs <= 0) return { steps: 0, rest: 0 };
  const owed = Math.floor(accumulatorMs / stepMs);
  const steps = Math.min(owed, maxSteps);
  // Drop what was skipped rather than carrying it: the alternative is a debt
  // the game can never repay, so it runs fast forever after one hiccup.
  return { steps, rest: owed > maxSteps ? 0 : accumulatorMs - steps * stepMs };
}
