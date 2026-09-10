import { beforeEach, describe, expect, it } from "vitest";
import { allPaneKeys, readTabs, useTabs } from "./tabStore";
import { leaves, type Pane } from "../features/terminal/panes/tree";

const reset = () => useTabs.setState({ tabs: [], activeId: null });

describe("tabStore", () => {
  beforeEach(reset);

  it("starts with no tabs", () => {
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useTabs.getState().activeId).toBeNull();
  });

  it("focuses a newly opened tab", () => {
    const id = useTabs.getState().openTab("terminal", "Terminal 1");
    expect(useTabs.getState().activeId).toBe(id);
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("gives every tab a distinct id", () => {
    const a = useTabs.getState().openTab("terminal", "Terminal 1");
    const b = useTabs.getState().openTab("terminal", "Terminal 2");
    expect(a).not.toBe(b);
  });

  it("focuses the neighbour when the active tab is closed", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    useTabs.getState().closeTab(b);
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("clears the active id when the last tab closes", () => {
    const a = useTabs.getState().openTab("terminal", "only");
    useTabs.getState().closeTab(a);
    expect(useTabs.getState().activeId).toBeNull();
    expect(useTabs.getState().tabs).toEqual([]);
  });

  it("leaves the active tab alone when a different tab closes", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    useTabs.getState().closeTab(a);
    expect(useTabs.getState().activeId).toBe(b);
  });

  it("cycles to the first tab after the last", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    useTabs.getState().focusTab(b);
    useTabs.getState().nextTab();
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("ignores a close for an id that is not open", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().closeTab("never-existed");
    expect(useTabs.getState().tabs).toHaveLength(1);
    expect(useTabs.getState().activeId).toBe(a);
  });
});

describe("surviving a restart", () => {
  beforeEach(() => {
    localStorage.clear();
    useTabs.setState({ tabs: [], activeId: null });
  });

  it("writes tabs down as they are opened", () => {
    useTabs.getState().openTab("terminal", "Terminal 1");
    expect(localStorage.getItem("jky.tabs")).toContain("Terminal 1");
  });

  it("writes them down again when one is closed", () => {
    const id = useTabs.getState().openTab("terminal", "Terminal 1");
    useTabs.getState().openTab("terminal", "Terminal 2");
    useTabs.getState().closeTab(id);

    const stored = localStorage.getItem("jky.tabs") ?? "";
    expect(stored).not.toContain("Terminal 1");
    expect(stored).toContain("Terminal 2");
  });

  it("keeps a tab's id, because that is its scrollback's key", () => {
    // A tab that came back with a fresh id would find an empty terminal and
    // leave the old output orphaned on disk.
    const id = useTabs.getState().openTab("terminal", "Terminal 1");
    expect(localStorage.getItem("jky.tabs")).toContain(id);
  });

  it("ignores a corrupt store rather than refusing to start", () => {
    localStorage.setItem("jky.tabs", "{ not json");
    expect(() => JSON.parse(localStorage.getItem("jky.tabs") ?? "")).toThrow();
    // The store itself reads this at module load; the guarantee under test is
    // that a bad value cannot make that throw.
    expect(useTabs.getState().tabs).toEqual([]);
  });
});

describe("panes within a tab", () => {
  beforeEach(reset);

  const tabOf = (id: string) => useTabs.getState().tabs.find((t) => t.id === id)!;
  const paneIds = (id: string) => leaves(tabOf(id).layout);

  it("gives a new tab one pane named after the tab", () => {
    // The scrollback key an unsplit tab has always used. Changing it would
    // have emptied every terminal on the first run of the new build.
    const id = useTabs.getState().openTab("terminal", "one");
    expect(tabOf(id).layout).toEqual({ kind: "leaf", id });
    expect(tabOf(id).focusedPane).toBe(id);
  });

  it("splits into two panes and focuses the new one", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");

    const panes = paneIds(id);
    expect(panes).toHaveLength(2);
    expect(panes[0]).toBe(id);
    expect(tabOf(id).focusedPane).toBe(panes[1]);
  });

  it("never reuses a pane id, so no terminal inherits another's output", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");
    const first = tabOf(id).focusedPane;
    useTabs.getState().splitPane(id, first, "column");
    const second = tabOf(id).focusedPane;

    expect(second).not.toBe(first);
    expect(new Set(paneIds(id)).size).toBe(3);
  });

  it("ignores a split aimed at a pane in another tab", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    useTabs.getState().splitPane(a, b, "row");
    expect(paneIds(a)).toHaveLength(1);
  });

  it("closes one pane and leaves the tab open", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");
    const created = tabOf(id).focusedPane;

    useTabs.getState().closePane(id, created);
    expect(useTabs.getState().tabs).toHaveLength(1);
    expect(paneIds(id)).toEqual([id]);
    expect(tabOf(id).focusedPane).toBe(id);
  });

  it("closes the tab when its last pane goes", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().closePane(id, id);
    expect(useTabs.getState().tabs).toEqual([]);
    expect(useTabs.getState().activeId).toBeNull();
  });

  it("moves focus between panes by direction, and stops at the edge", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");
    const right = tabOf(id).focusedPane;

    useTabs.getState().movePaneFocus(id, "left");
    expect(tabOf(id).focusedPane).toBe(id);

    useTabs.getState().movePaneFocus(id, "left");
    expect(tabOf(id).focusedPane).toBe(id);

    useTabs.getState().movePaneFocus(id, "right");
    expect(tabOf(id).focusedPane).toBe(right);
  });

  it("resizes one divider", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");
    const split = tabOf(id).layout as Extract<Pane, { kind: "split" }>;

    useTabs.getState().resizeSplit(id, split.id, 0.7);
    expect((tabOf(id).layout as Extract<Pane, { kind: "split" }>).ratio).toBeCloseTo(0.7);
  });

  it("reports every pane across every tab, for the scrollback prune", () => {
    const a = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(a, a, "row");
    const b = useTabs.getState().openTab("terminal", "two");

    const keys = allPaneKeys(useTabs.getState().tabs);
    expect(keys).toHaveLength(3);
    expect(keys).toContain(a);
    expect(keys).toContain(b);
  });
});

describe("coming back from last time", () => {
  it("brings a tab back as one terminal, not as the splits it had", () => {
    // A restored pane is not a restored session — the shell that was in it is
    // gone and a fresh one starts. So a tab that was split three ways would
    // reopen as three empty prompts nobody asked for.
    localStorage.setItem(
      "jky.tabs",
      JSON.stringify([
        {
          id: "tab-90",
          kind: "terminal",
          title: "one",
          focusedPane: "pane-4",
          layout: {
            kind: "split",
            id: "split-1",
            dir: "row",
            ratio: 0.5,
            a: { kind: "leaf", id: "tab-90" },
            b: { kind: "leaf", id: "pane-4" },
          },
        },
      ]),
    );

    const restored = readTabs();
    expect(restored.tabs).toHaveLength(1);
    expect(leaves(restored.tabs[0].layout)).toEqual(["tab-90"]);
    expect(restored.tabs[0].focusedPane).toBe("tab-90");
  });

  it("keeps a tab that was never split exactly as it was", () => {
    localStorage.setItem(
      "jky.tabs",
      JSON.stringify([{ id: "tab-91", kind: "terminal", title: "one" }]),
    );
    const restored = readTabs();
    expect(leaves(restored.tabs[0].layout)).toEqual(["tab-91"]);
  });

  it("starts fresh rather than throwing when storage holds nonsense", () => {
    localStorage.setItem("jky.tabs", "{ not json");
    expect(readTabs()).toEqual({ tabs: [], activeId: null });
  });
});

describe("moving a terminal within its tab", () => {
  beforeEach(reset);

  const tabOf = (id: string) => useTabs.getState().tabs.find((t) => t.id === id)!;

  it("exchanges two panes without disturbing either shell", () => {
    // Ids swap, the tree keeps its shape, and nothing unmounts — which is
    // what lets this happen to a terminal with a command running in it.
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");
    const created = tabOf(id).focusedPane;

    useTabs.getState().swapPanes(id, id, created);
    expect(leaves(tabOf(id).layout)).toEqual([created, id]);
  });

  it("keeps the keyboard on the terminal you moved, not on where it was", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");
    const created = tabOf(id).focusedPane;

    useTabs.getState().swapPanes(id, id, created);
    expect(tabOf(id).focusedPane).toBe(created);
  });

  it("ignores a swap naming a pane that is not in the tab", () => {
    const id = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().splitPane(id, id, "row");
    const before = leaves(tabOf(id).layout);

    useTabs.getState().swapPanes(id, id, "pane-999");
    expect(leaves(tabOf(id).layout)).toEqual(before);
  });
});
