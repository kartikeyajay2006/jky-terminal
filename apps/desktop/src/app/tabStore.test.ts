import { beforeEach, describe, expect, it } from "vitest";
import { useTabs } from "./tabStore";

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
