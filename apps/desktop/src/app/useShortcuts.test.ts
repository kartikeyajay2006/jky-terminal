import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useShortcuts } from "./useShortcuts";
import { useTabs } from "./tabStore";

function press(key: string, mods: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods }),
  );
}

describe("useShortcuts", () => {
  beforeEach(() => useTabs.setState({ tabs: [], activeId: null }));

  it("opens a terminal on ctrl+t", () => {
    renderHook(() => useShortcuts());
    press("t", { ctrlKey: true });
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("opens a terminal on cmd+t for macOS users", () => {
    renderHook(() => useShortcuts());
    press("t", { metaKey: true });
    expect(useTabs.getState().tabs).toHaveLength(1);
  });

  it("closes the active tab on ctrl+w", () => {
    renderHook(() => useShortcuts());
    useTabs.getState().openTab("terminal", "one");
    press("w", { ctrlKey: true });
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it("cycles tabs on ctrl+tab", () => {
    renderHook(() => useShortcuts());
    const a = useTabs.getState().openTab("terminal", "one");
    useTabs.getState().openTab("terminal", "two");
    press("Tab", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("jumps straight to a tab by number", () => {
    renderHook(() => useShortcuts());
    const a = useTabs.getState().openTab("terminal", "one");
    const b = useTabs.getState().openTab("terminal", "two");
    press("1", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(a);
    press("2", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(b);
  });

  it("ignores a number with no tab behind it", () => {
    renderHook(() => useShortcuts());
    const a = useTabs.getState().openTab("terminal", "one");
    press("9", { ctrlKey: true });
    expect(useTabs.getState().activeId).toBe(a);
  });

  it("ignores an unmodified keystroke so typing in the terminal still works", () => {
    renderHook(() => useShortcuts());
    press("t");
    expect(useTabs.getState().tabs).toHaveLength(0);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = renderHook(() => useShortcuts());
    unmount();
    press("t", { ctrlKey: true });
    expect(useTabs.getState().tabs).toHaveLength(0);
  });
});
