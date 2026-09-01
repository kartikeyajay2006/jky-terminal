import { useCallback, useEffect, useRef, useState } from "react";
import { useXterm } from "./useXterm";
import { TerminalSearch } from "./TerminalSearch";
import { TerminalMenu, type MenuPoint } from "./TerminalMenu";
import { FailureHelp } from "./FailureHelp";
import type { CommandFailure } from "./commandFailure";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalProps {
  tabId: string;
}

export function Terminal({ tabId }: TerminalProps) {
  const container = useRef<HTMLDivElement>(null);
  // The tab id is the key its scrollback is saved under.
  /*
   * The last command that failed, if the shell reported one.
   *
   * Replaced rather than queued: a second failure is the one you are looking
   * at, and a stack of offers under a terminal would be worse than none.
   */
  const [failure, setFailure] = useState<CommandFailure | null>(null);
  const term = useXterm(container, tabId, setFailure);

  const [searching, setSearching] = useState(false);
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);

  const closeSearch = useCallback(() => {
    setSearching(false);
    term.clearSearch();
    // Focus goes back to the shell, or the next thing typed lands nowhere.
    term.focus();
  }, [term]);

  // Ctrl/Cmd+F opens the find bar. Bound on the window rather than the
  // terminal element because xterm swallows keystrokes aimed at the shell,
  // and a find shortcut that only works when the terminal is *not* focused
  // would be useless.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && !e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearching(true);
        return;
      }
      // Ctrl/Cmd+Shift+C and V, the terminal convention: the unshifted pair
      // belong to the shell, where Ctrl+C is interrupt.
      if (mod && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        void term.copySelection();
        return;
      }
      if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        void term.paste();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [term]);

  return (
    <div className="term__wrap">
      <div
        className="term"
        role="application"
        aria-label="Terminal"
        data-tab-id={tabId}
        ref={container}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuAt({ x: e.clientX, y: e.clientY });
        }}
      />

      {/* Under the terminal rather than inside it: the offer needs buttons and
          focus, and xterm draws characters. It sits in the same box so it
          reads as part of the output it is about. */}
      {failure && (
        <FailureHelp
          failure={failure}
          recentOutput={() => term.recentOutput()}
          onDismiss={() => {
            setFailure(null);
            term.focus();
          }}
        />
      )}

      {searching && (
        <TerminalSearch
          hits={term.hits}
          onSearch={term.search}
          onNext={term.findNext}
          onPrevious={term.findPrevious}
          onClose={closeSearch}
        />
      )}

      {menuAt && (
        <TerminalMenu
          at={menuAt}
          onClose={() => setMenuAt(null)}
          items={[
            {
              label: "Copy",
              hint: "Ctrl+Shift+C",
              // Nothing selected means nothing to copy, and an enabled item
              // that does nothing is worse than a greyed-out one.
              disabled: term.selection().length === 0,
              run: () => void term.copySelection(),
            },
            {
              label: "Paste",
              hint: "Ctrl+Shift+V",
              run: () => void term.paste(),
            },
            {
              label: "Search",
              hint: "Ctrl+F",
              run: () => setSearching(true),
            },
            {
              label: "Clear",
              run: () => {
                term.clear();
                term.focus();
              },
            },
          ]}
        />
      )}
    </div>
  );
}
