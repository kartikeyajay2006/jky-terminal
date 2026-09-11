import { create } from "zustand";

/** What a terminal is doing, as far as its shell has said. */
export type Activity = "idle" | "running" | "failed";

/**
 * How long a command has to run before anybody is told about it.
 *
 * Almost everything anyone types finishes inside this, and marking those
 * would be a rail that flickered on every `ls`. What is worth reporting is
 * the command you are now waiting on.
 */
export const SLOW_MS = 600;

/** How long a failure stays marked before the rail settles again. */
export const FAILED_MS = 4000;

interface ActivityState {
  /** What each pane is doing, by pane id. Absent means idle. */
  panes: Record<string, Activity>;
  /** A pane began a command. Reported only once it has run long enough. */
  started: (pane: string) => void;
  /** A command finished. A non-zero status is worth saying out loud. */
  finished: (pane: string, exitCode: number | null) => void;
  /** A pane went away. */
  forget: (pane: string) => void;
}

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function clear(pane: string): void {
  const timer = timers.get(pane);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(pane);
  }
}

/**
 * What the terminals are doing, for the parts of the app that are not one.
 *
 * The shell reports where a command begins and how it ended through OSC 133,
 * which means this is knowledge rather than a guess — a terminal that watched
 * its own output for a prompt could only estimate, and would be wrong on
 * every command that printed something prompt-shaped.
 *
 * It is a store rather than a prop because the things that want it are
 * nowhere near the terminal: the rail, the tab strip, the window itself.
 */
export const useActivity = create<ActivityState>((set) => ({
  panes: {},

  started: (pane) => {
    clear(pane);
    // A new command makes the last one's result history, so whatever this
    // pane was saying goes now. Clearing only the timer left a failure
    // latched for ever, because the fade that would have removed it was the
    // timer just cancelled.
    set((s) => {
      if (s.panes[pane] === undefined) return s;
      const { [pane]: _gone, ...panes } = s.panes;
      return { panes };
    });

    // Held back, so the rail does not flicker on every `ls`. What is worth
    // reporting is the command you are now waiting on.
    timers.set(
      pane,
      setTimeout(() => {
        timers.delete(pane);
        set((s) => ({ panes: { ...s.panes, [pane]: "running" } }));
      }, SLOW_MS),
    );
  },

  finished: (pane, exitCode) => {
    clear(pane);

    if (exitCode === null || exitCode === 0) {
      set((s) => {
        const { [pane]: _gone, ...panes } = s.panes;
        return { panes };
      });
      return;
    }

    set((s) => ({ panes: { ...s.panes, [pane]: "failed" } }));
    // A failure fades rather than latching: it is a thing that happened, not
    // a state the terminal is in, and a mark that stayed would still be there
    // an hour later saying nothing.
    timers.set(
      pane,
      setTimeout(() => {
        timers.delete(pane);
        set((s) => {
          if (s.panes[pane] !== "failed") return s;
          const { [pane]: _gone, ...panes } = s.panes;
          return { panes };
        });
      }, FAILED_MS),
    );
  },

  forget: (pane) => {
    clear(pane);
    set((s) => {
      const { [pane]: _gone, ...panes } = s.panes;
      return { panes };
    });
  },
}));

/** What one pane is doing. */
export function activityOf(pane: string): Activity {
  return useActivity.getState().panes[pane] ?? "idle";
}

/**
 * What the app as a whole is doing.
 *
 * A failure anywhere outranks a command running anywhere, because it is the
 * one that has already happened and can be missed.
 */
export function overallActivity(panes: Record<string, Activity>): Activity {
  const states = Object.values(panes);
  if (states.includes("failed")) return "failed";
  if (states.includes("running")) return "running";
  return "idle";
}
