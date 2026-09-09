import { useCallback, useEffect, useRef, useState } from "react";
import { useXterm } from "./useXterm";
import { TerminalSearch } from "./TerminalSearch";
import { TerminalMenu, type MenuPoint } from "./TerminalMenu";
import { FailureHelp } from "./FailureHelp";
import { CommandApp } from "./CommandApp";
import { recognise, type Recognised } from "./recognise";
import type { CommandDone } from "./commandFailure";
import type { Direction } from "./panes/tree";
import { actionFor, chordFor } from "../../app/keymapStore";
import { getPlatform } from "../../platform";
import { TYPE_EVENT } from "./typeEvent";
import { useCompletion } from "./complete/useCompletion";
import { Suggestions } from "./complete/Suggestions";
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
    // Every finished command goes to the history, whether or not anything on
    // screen has a use for it. This is the only moment the app knows what was
    // typed, where, and how it ended — the shell says so once and then the
    // line is gone.
    void getPlatform()
      .history.record({
        command: completion.command,
        cwd: completion.cwd,
        code: completion.code,
        at: Date.now(),
        session: paneId,
      })
      .catch(() => {});

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

  // A command chosen somewhere else in the app — the history, for now —
  // arriving at this prompt. Typed, never run: the person still presses
  // Enter, which is the same rule the command panels follow and for the same
  // reason.
  useEffect(() => {
    function onType(e: Event) {
      const detail = (e as CustomEvent<{ pane: string; text: string }>).detail;
      if (!detail || detail.pane !== paneId) return;
      term.type(detail.text);
      term.focus();
    }
    window.addEventListener(TYPE_EVENT, onType);
    return () => window.removeEventListener(TYPE_EVENT, onType);
  }, [paneId, term]);

  const [searching, setSearching] = useState(false);
  const [menuAt, setMenuAt] = useState<MenuPoint | null>(null);

  /*
   * What could come next on the prompt.
   *
   * Only the focused pane asks — a split tab would otherwise have every
   * terminal in it polling its own prompt — and only while nothing else owns
   * the keyboard. The offer under a failed command and the panel under a
   * recognised one both claim number keys through the same channel this
   * does, and two things claiming it is one of them silently losing.
   */
  const completion = useCompletion(term, focused && !searching && !failure && !found);

  /*
   * Take Tab and the arrows while the list is open.
   *
   * The only way to take them. xterm handles a key by calling
   * `stopPropagation`, so a window listener never sees one while a terminal
   * has focus — which is why this goes through `claimKeys` rather than
   * through the usual shortcut path. The keys go straight back the moment
   * the list closes, because Tab at a prompt belongs to the shell.
   */
  useEffect(() => {
    // Nothing claimed when the list is shut, rather than claiming nothing:
    // handing the keys back here would take them from whichever panel has
    // them.
    if (!completion.open) return;

    term.claimKeys((event) => {
      if (event.type !== "keydown") return false;

      switch (event.key) {
        case "Tab":
          completion.accept();
          return true;
        case "ArrowDown":
          completion.move(1);
          return true;
        case "ArrowUp":
          completion.move(-1);
          return true;
        case "Escape":
          completion.dismiss();
          return true;
        default:
          // Everything else reaches the shell, including Enter. A list open
          // over a finished command must not swallow the Enter that runs it.
          return false;
      }
    });

    return () => term.claimKeys(null);
  }, [completion, term]);

  const closeSearch = useCallback(() => {
    setSearching(false);
    term.clearSearch();
    // Focus goes back to the shell, or the next thing typed lands nowhere.
    term.focus();
  }, [term]);

  // Find, copy and paste. Bound on the window rather than the terminal
  // element because xterm swallows keystrokes aimed at the shell, and a find
  // shortcut that only works when the terminal is *not* focused would be
  // useless. Which chord means which is the keymap's business, not this
  // component's — so rebinding one actually rebinds it.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Window listeners fire once per mounted terminal, and a tab may hold
      // several. Without this every pane in the tab opened its own find bar
      // and pasted into its own shell.
      if (!focused) return;

      switch (actionFor(e)) {
        case "terminal-find":
          e.preventDefault();
          setSearching(true);
          return;
        // Copy and paste default to the shifted pair, the terminal
        // convention: the unshifted ones belong to the shell, where Ctrl+C
        // is interrupt.
        case "terminal-copy":
          e.preventDefault();
          void term.copySelection();
          return;
        case "terminal-paste":
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

      {/* Under the terminal, over its last rows. Anchored to the box rather
          than to the caret: following the caret means measuring a cell in a
          canvas and re-measuring it on every font change and resize, for a
          list that is read by moving your eyes anyway. */}
      {completion.open && (
        <Suggestions
          items={completion.items}
          index={completion.index}
          word={completion.word}
          onAccept={completion.accept}
          onSelect={completion.select}
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
              hint: chordFor("terminal-copy"),
              // Nothing selected means nothing to copy, and an enabled item
              // that does nothing is worse than a greyed-out one.
              disabled: term.selection().length === 0,
              run: () => void term.copySelection(),
            },
            {
              label: "Paste",
              hint: chordFor("terminal-paste"),
              run: () => void term.paste(),
            },
            {
              label: "Search",
              hint: chordFor("terminal-find"),
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
                    hint: chordFor("pane-split-right"),
                    run: () => onSplit("row"),
                  },
                  {
                    label: "Split down",
                    hint: chordFor("pane-split-down"),
                    run: () => onSplit("column"),
                  },
                ]
              : []),
            ...(onClosePane
              ? [
                  {
                    label: "Close pane",
                    hint: chordFor("pane-close"),
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
