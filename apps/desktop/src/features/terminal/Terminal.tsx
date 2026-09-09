import { useCallback, useEffect, useRef, useState } from "react";
import { useXterm } from "./useXterm";
import { TerminalSearch } from "./TerminalSearch";
import { TerminalMenu, type MenuPoint } from "./TerminalMenu";
import { FailureHelp } from "./FailureHelp";
import { CommandApp } from "./CommandApp";
import { recognise, type Recognised } from "./recognise";
import type { CommandDone } from "./commandFailure";
import type { Direction } from "./panes/tree";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface TerminalProps {
  /**
   * The key this terminal's scrollback is saved under.
   *
   * Named for the pane rather than the tab because a tab holds several now.
   * A tab's first pane is still named after the tab, so nothing moved on
   * disk when splits arrived.
   */
  paneId: string;
  /**
   * Whether this pane has the keyboard.
   *
   * A tab may hold several terminals now, and only one of them may take a
   * keystroke. Defaults to true so a terminal rendered on its own — which is
   * what every test does — behaves the way it always has.
   */
  focused?: boolean;
  /** Draw a border showing which pane is live. Off when a tab holds one. */
  showFocusRing?: boolean;
  /**
   * Put another terminal beside this one.
   *
   * Passed in rather than read from the tab store so a terminal stays a
   * terminal: it knows how to draw a shell, not which tab it is in. Absent
   * in the tests, and the menu simply does not offer it.
   */
  onSplit?: (dir: Direction) => void;
  /** Close this pane. Absent when there is nothing above to close it. */
  onClosePane?: () => void;
}

export function Terminal({
  paneId,
  focused = true,
  showFocusRing = false,
  onSplit,
  onClosePane,
}: TerminalProps) {
  const container = useRef<HTMLDivElement>(null);
  /*
   * The last command that failed, if the shell reported one.
   *
   * Replaced rather than queued: a second failure is the one you are looking
   * at, and a stack of offers under a terminal would be worse than none.
   */
  const [failure, setFailure] = useState<CommandDone | null>(null);

  /*
   * What the last command turned out to be, if it turned out to be anything.
   *
   * Replaced rather than stacked: a panel per command would bury the terminal
   * under its own history, and the one you want is the one you just ran.
   */
  const [found, setFound] = useState<Recognised | null>(null);
  /** Shown in the panel's head, so it is anchored to what was typed. */
  const [ranCommand, setRanCommand] = useState("");

  const term = useXterm(container, paneId, setFailure, (completion) => {
    const recognised = recognise(completion);
    setFound(recognised);
    if (recognised) setRanCommand(completion.command);
  });

  // Hand the keyboard to whichever pane is focused. Done here rather than on
  // click alone because focus also moves by shortcut, and a pane that lit up
  // without taking keystrokes would be lying about where typing goes.
  useEffect(() => {
    if (focused) term.focus();
  }, [focused, term]);

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
      // Window listeners fire once per mounted terminal, and a tab may now
      // hold several. Without this every pane in the tab opened its own find
      // bar and pasted into its own shell.
      if (!focused) return;
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
  }, [term, focused]);

  return (
    <div className="term__wrap" data-ring={showFocusRing ? "true" : undefined}>
      <div
        className="term"
        role="application"
        aria-label="Terminal"
        data-pane-id={paneId}
        ref={container}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuAt({ x: e.clientX, y: e.clientY });
        }}
      />

      {/* Under the terminal rather than inside it: the offer needs buttons and
          focus, and xterm draws characters. It sits in the same box so it
          reads as part of the output it is about. */}
      {/* One panel at a time. Two stacked under a terminal would be two
          things competing for the same number keys, and the one you wanted
          would be a guess. A failure is the more urgent of the two. */}
      {failure ? (
        <FailureHelp
          failure={failure}
          recentOutput={() => term.recentOutput()}
          claimKeys={term.claimKeys}
          onDismiss={() => {
            setFailure(null);
            term.focus();
          }}
        />
      ) : null}

      {/* What the command turned out to be. Under the output rather than in
          place of it: the text is still above, untouched, and this can be
          dismissed. A terminal that swallowed what a command printed would be
          unusable the first time it got something wrong. */}
      {found && !failure && (
        <CommandApp
          found={found}
          command={ranCommand}
          claimKeys={term.claimKeys}
          onRun={(command) => {
            // Typed, not run. The person still presses Enter, and sees
            // exactly what they are about to run.
            term.type(command);
            setFound(null);
            term.focus();
          }}
          onDismiss={() => {
            setFound(null);
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
            ...(onSplit
              ? [
                  {
                    label: "Split right",
                    hint: "Ctrl+Shift+D",
                    run: () => onSplit("row"),
                  },
                  {
                    label: "Split down",
                    hint: "Ctrl+Shift+E",
                    run: () => onSplit("column"),
                  },
                ]
              : []),
            ...(onClosePane
              ? [
                  {
                    label: "Close pane",
                    hint: "Ctrl+Shift+W",
                    run: () => onClosePane(),
                  },
                ]
              : []),
          ]}
        />
      )}
    </div>
  );
}
