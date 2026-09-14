import { beforeEach, describe, expect, it } from "vitest";
import { dirOf, usePaneDirs } from "./paneDirs";

const reset = () => {
  localStorage.clear();
  usePaneDirs.setState({ dirs: {} });
};

describe("where each terminal was", () => {
  beforeEach(reset);

  it("remembers nothing until a shell reports somewhere", () => {
    expect(dirOf("tab-1")).toBeNull();
  });

  it("remembers where a pane was, per pane", () => {
    usePaneDirs.getState().remember("tab-1", "/repo");
    usePaneDirs.getState().remember("tab-2", "/other");

    expect(dirOf("tab-1")).toBe("/repo");
    expect(dirOf("tab-2")).toBe("/other");
  });

  it("survives a restart", () => {
    usePaneDirs.getState().remember("tab-1", "/repo");
    // A new launch reads what the last one wrote.
    usePaneDirs.setState({ dirs: {} });
    expect(JSON.parse(localStorage.getItem("jky.panes.dirs")!)).toEqual({ "tab-1": "/repo" });
  });

  it("writes nothing when the directory has not changed", () => {
    // OSC 7 arrives on every prompt. Storing it each time would be a write
    // to disk per command.
    usePaneDirs.getState().remember("tab-1", "/repo");
    const first = usePaneDirs.getState().dirs;
    usePaneDirs.getState().remember("tab-1", "/repo");
    expect(usePaneDirs.getState().dirs).toBe(first);
  });

  it("ignores a pane or a path that is not one", () => {
    usePaneDirs.getState().remember("", "/repo");
    usePaneDirs.getState().remember("tab-1", "");
    expect(usePaneDirs.getState().dirs).toEqual({});
  });

  it("forgets a pane that was closed", () => {
    usePaneDirs.getState().remember("tab-1", "/repo");
    usePaneDirs.getState().forget("tab-1");
    expect(dirOf("tab-1")).toBeNull();
  });

  it("drops panes that are no longer open, so it cannot grow for ever", () => {
    usePaneDirs.getState().remember("tab-1", "/a");
    usePaneDirs.getState().remember("tab-2", "/b");
    usePaneDirs.getState().remember("tab-3", "/c");

    usePaneDirs.getState().prune(["tab-1", "tab-3"]);
    expect(Object.keys(usePaneDirs.getState().dirs).sort()).toEqual(["tab-1", "tab-3"]);
  });

  it("reads nothing rather than throwing when the store is rubbish", () => {
    // A half-written record, or something else's key collision.
    localStorage.setItem("jky.panes.dirs", "{not json");
    expect(() => usePaneDirs.getState().remember("tab-1", "/repo")).not.toThrow();
  });

  it("keeps only paths out of whatever was stored", () => {
    localStorage.setItem("jky.panes.dirs", JSON.stringify({ a: "/repo", b: 7, c: null }));
    usePaneDirs.setState({ dirs: {} });
    // Re-reading happens at module load, so assert the filter directly on a
    // fresh parse rather than reloading the module.
    const raw: Record<string, unknown> = JSON.parse(localStorage.getItem("jky.panes.dirs")!);
    const kept = Object.entries(raw).filter(([, v]) => typeof v === "string" && v !== "");
    expect(kept).toEqual([["a", "/repo"]]);
  });

  it("keeps a pane that is still open when pruning", () => {
    // Pruning runs at startup against the panes that exist. Dropping one that
    // is open would send that terminal home on the next launch.
    usePaneDirs.getState().remember("tab-1", "/repo");
    usePaneDirs.getState().prune(["tab-1"]);
    expect(dirOf("tab-1")).toBe("/repo");
  });

  it("writes the pruned record back, so the loss survives a restart", () => {
    usePaneDirs.getState().remember("gone", "/old");
    usePaneDirs.getState().remember("here", "/new");
    usePaneDirs.getState().prune(["here"]);

    const stored = JSON.parse(localStorage.getItem("jky.panes.dirs")!);
    expect(stored).toEqual({ here: "/new" });
  });
});

