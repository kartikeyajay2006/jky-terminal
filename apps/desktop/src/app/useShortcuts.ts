import { useEffect } from "react";
import { useTabs } from "./tabStore";
import { isAppShortcut } from "./shortcuts";

/**
 * Window-level shortcuts.
 *
 * Every binding requires a modifier. An unmodified key must reach the
 * terminal — a shell is the one place where every keystroke is meaningful.
 */
export function useShortcuts(): void {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // One definition of what the app claims, shared with the terminal's
      // custom key handler so the two cannot disagree about which keys get
      // through.
      if (!isAppShortcut(e)) return;
      if (e.shiftKey) return;

      const { openTab, closeTab, nextTab, focusTab, tabs, activeId } = useTabs.getState();

      switch (e.key.toLowerCase()) {
        case "t":
          e.preventDefault();
          openTab("terminal", `Terminal ${tabs.length + 1}`);
          return;
        case "w":
          if (activeId) {
            e.preventDefault();
            closeTab(activeId);
          }
          return;
        case "tab":
          e.preventDefault();
          nextTab();
          return;
      }

      // Ctrl/Cmd+1..9 jumps straight to a tab. An out-of-range number does
      // nothing rather than clamping: jumping to a tab that is not there
      // would be a surprise, doing nothing is not.
      if (/^[1-9]$/.test(e.key)) {
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
