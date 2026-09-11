import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activityOf, overallActivity, FAILED_MS, SLOW_MS, useActivity } from "./activity";

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
});
