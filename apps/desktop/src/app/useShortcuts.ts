import { useEffect } from "react";
import { useTabs } from "./tabStore";
import { useRail } from "./railStore";
import { actionFor } from "./keymapStore";
import type { Side } from "../features/terminal/panes/tree";

/** Which way each focus action moves the keyboard between panes. */
const SIDES: Record<string, Side> = {
  "pane-focus-left": "left",
  "pane-focus-right": "right",
  "pane-focus-up": "up",
  "pane-focus-down": "down",
};

/**
 * Window-level shortcuts.
 *
 * Which keystroke means what is not decided here any more — `jky-keys` owns
 * that, and this asks it. What is decided here is what each action *does*,
 * which is the part that belongs to the window.
 *
 * Every binding still requires a modifier, and that rule is enforced where
 * bindings are made rather than here: an unmodified key must reach the
 * terminal, because a shell is the one place where every keystroke is
 * meaningful.
 */
export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const action = actionFor(e);
      const state = useTabs.getState();
      const { openTab, closeTab, nextTab, focusTab, tabs, activeId } = state;
      const tab = tabs.find((t) => t.id === activeId);

      switch (action) {
        case null:
          break;
        case "rail-toggle":
          e.preventDefault();
          useRail.getState().toggle();
          return;
        case "tab-new":
          e.preventDefault();
          openTab("terminal", `Terminal ${tabs.length + 1}`);
          return;
        case "tab-close":
          if (activeId) {
            e.preventDefault();
            closeTab(activeId);
          }
          return;
        case "tab-next":
          e.preventDefault();
          nextTab();
          return;
        case "pane-split-right":
          if (tab) {
            e.preventDefault();
            state.splitPane(tab.id, tab.focusedPane, "row");
          }
          return;
        case "pane-split-down":
          if (tab) {
            e.preventDefault();
            state.splitPane(tab.id, tab.focusedPane, "column");
          }
          return;
        case "pane-close":
          if (tab) {
            e.preventDefault();
            state.closePane(tab.id, tab.focusedPane);
          }
          return;
      }

      const side = action ? SIDES[action] : undefined;
      if (side && tab) {
        e.preventDefault();
        state.movePaneFocus(tab.id, side);
        return;
      }
      // A bound chord that got this far belongs to a component rather than
      // to the window — copy, paste and find are answered by the terminal
      // that has focus, and must not be swallowed here.
      if (action) return;

      // Ctrl/Cmd+1..9 jumps straight to a tab. Not in the keymap: nine
      // bindings that differ only by a digit would be nine rows of a settings
      // table saying the same thing, and the digit *is* the meaning. An
      // out-of-range number does nothing rather than clamping — jumping to a
      // tab that is not there would be a surprise, doing nothing is not.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const target = tabs[Number(e.key) - 1];
        if (target) {
          e.preventDefault();
          focusTab(target.id);
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
