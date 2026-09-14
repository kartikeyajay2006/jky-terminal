import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityOf, overallActivity, FAILED_MS, SLOW_MS, useActivity, runningCount } from "./activity";

describe("what a terminal is doing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useActivity.setState({ panes: {} });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says nothing about a terminal that has done nothing", () => {
    expect(activityOf("pane-1")).toBe("idle");
  });

  it("says nothing about a command that finished quickly", () => {
    // Marking those would be a rail that flickered on every `ls`.
    useActivity.getState().started("pane-1");
    vi.advanceTimersByTime(SLOW_MS - 50);
    useActivity.getState().finished("pane-1", 0);
    vi.advanceTimersByTime(SLOW_MS);

    expect(activityOf("pane-1")).toBe("idle");
  });

  it("reports a command still running once it has taken long enough", () => {
    useActivity.getState().started("pane-1");
    expect(activityOf("pane-1")).toBe("idle");

    vi.advanceTimersByTime(SLOW_MS);
    expect(activityOf("pane-1")).toBe("running");
  });

  it("settles the moment a long command succeeds", () => {
    useActivity.getState().started("pane-1");
    vi.advanceTimersByTime(SLOW_MS);
    useActivity.getState().finished("pane-1", 0);

    expect(activityOf("pane-1")).toBe("idle");
  });

  it("marks a failure however long the command took", () => {
    useActivity.getState().started("pane-1");
    useActivity.getState().finished("pane-1", 1);
    expect(activityOf("pane-1")).toBe("failed");
  });

  it("lets a failure pass rather than latching it", () => {
    // It is a thing that happened, not a state the terminal is in — a mark
    // that stayed would still be there an hour later saying nothing.
    useActivity.getState().finished("pane-1", 127);
    expect(activityOf("pane-1")).toBe("failed");

    vi.advanceTimersByTime(FAILED_MS);
    expect(activityOf("pane-1")).toBe("idle");
  });

  it("treats a shell that reported no status as nothing to say", () => {
    useActivity.getState().finished("pane-1", null);
    expect(activityOf("pane-1")).toBe("idle");
  });

  it("a new command clears the failure before it", () => {
    useActivity.getState().finished("pane-1", 1);
    useActivity.getState().started("pane-1");
    expect(activityOf("pane-1")).toBe("idle");

    vi.advanceTimersByTime(SLOW_MS);
    expect(activityOf("pane-1")).toBe("running");
  });

  it("keeps each terminal's state to itself", () => {
    useActivity.getState().started("pane-1");
    vi.advanceTimersByTime(SLOW_MS);
    useActivity.getState().finished("pane-2", 1);

    expect(activityOf("pane-1")).toBe("running");
    expect(activityOf("pane-2")).toBe("failed");
  });

  it("forgets a pane that went away, timer and all", () => {
    useActivity.getState().started("pane-1");
    useActivity.getState().forget("pane-1");
    vi.advanceTimersByTime(SLOW_MS * 2);

    expect(activityOf("pane-1")).toBe("idle");
  });
});

describe("what the app as a whole is doing", () => {
  it("is idle when everything is", () => {
    expect(overallActivity({})).toBe("idle");
    expect(overallActivity({ a: "idle" })).toBe("idle");
  });

  it("is running when anything is", () => {
    expect(overallActivity({ a: "idle", b: "running" })).toBe("running");
  });

  it("puts a failure ahead of a command still running", () => {
    // The failure has already happened and is the one that can be missed.
    expect(overallActivity({ a: "running", b: "failed" })).toBe("failed");
  });

  describe("counting what is still going", () => {
    it("counts only the panes mid-command", () => {
      expect(
        runningCount({ a: "running", b: "idle", c: "running", d: "failed" }),
      ).toBe(2);
    });

    it("counts a failure as finished, because it is", () => {
      // It stopped. There is nothing to lose by closing on it.
      expect(runningCount({ a: "failed", b: "idle" })).toBe(0);
    });

    it("counts nothing when nothing is open", () => {
      expect(runningCount({})).toBe(0);
    });
  });
});

describe("shells that outlive the window", () => {
  it("does not count a command in a shell that outlives the window as lost by quitting", () => {
    const panes = { "pane-1": "running", "pane-2": "running", "pane-3": "idle" } as const;
    expect(runningCount(panes)).toBe(2);
    expect(runningCount(panes, { "pane-1": true })).toBe(1);
  });

  it("remembers which panes survive, and forgets with the pane", () => {
    useActivity.getState().held("pane-9", true);
    expect(useActivity.getState().survivors["pane-9"]).toBe(true);

    useActivity.getState().held("pane-9", false);
    expect(useActivity.getState().survivors["pane-9"]).toBeUndefined();

    useActivity.getState().held("pane-9", true);
    useActivity.getState().forget("pane-9");
    expect(useActivity.getState().survivors["pane-9"]).toBeUndefined();
  });
});
