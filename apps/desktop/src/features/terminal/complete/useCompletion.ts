import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform, type Completions, type Suggestion } from "../../../platform";
import type { TerminalControls } from "../useXterm";

/** How many are worth showing. More than this is a list nobody reads. */
const LIMIT = 40;

/**
 * How often the prompt is re-read.
 *
 * Polled rather than driven by keystrokes, because what is on the prompt
 * changes for reasons the window never sees — history recall with the up
 * arrow, the shell rewriting the line, a paste — and a listener on keys would
 * miss every one of them. Cheap: it reads one row of a buffer already in
 * memory and asks nothing unless the text changed.
 */
const POLL_MS = 70;

export interface CompletionState {
  items: Suggestion[];
  /** Which row is selected. Always valid when `items` is non-empty. */
  index: number;
  /** The word being completed, for highlighting the matched prefix. */
  word: string;
  open: boolean;
}

export interface Completion extends CompletionState {
  /**
   * Take the selected suggestion, or the one given.
   *
   * Answers whether it actually put anything on the prompt. False means the
   * suggestion was already what is typed, and the caller should let the
   * keystroke through — an Enter that took a completion changing nothing
   * would be an Enter that did nothing at all.
   */
  accept: (item?: Suggestion) => boolean;
  dismiss: () => void;
  move: (delta: number) => void;
  select: (index: number) => void;
}

/**
 * Suggestions for whatever is typed at the prompt.
 *
 * Never opens on an empty prompt: a list that appears the moment a prompt
 * does is a list in the way, and offering every program on the machine
 * answers no question anyone asked.
 */
export function useCompletion(term: TerminalControls, active: boolean): Completion {
  const [state, setState] = useState<CompletionState>({
    items: [],
    index: 0,
    word: "",
    open: false,
  });

  /** What was on the prompt when the last answer was asked for. */
  const asked = useRef("");
  /** Dismissed until the prompt changes again, so Escape stays dismissed. */
  const muted = useRef<string | null>(null);
  /** Rising number, so a slow answer cannot overwrite a newer one. */
  const turn = useRef(0);

  /**
   * What is on screen, readable without a state updater.
   *
   * `accept` writes to the pty, and doing that inside `setState` meant React
   * ran it twice under StrictMode — which sent the completion to the shell
   * twice. A side effect belongs outside the updater; this is how it reads
   * the current selection from there.
   */
  const view = useRef(state);
  view.current = state;

  const close = useCallback(() => {
    setState((s) => (s.open || s.items.length > 0 ? { ...s, open: false, items: [] } : s));
  }, []);

  useEffect(() => {
    if (!active) {
      close();
      return;
    }

    function look() {
      const at = term.promptInput();
      // No prompt yet, or a command is running. Either way there is nothing
      // being typed to complete.
      if (!at) {
        close();
        return;
      }

      const typed = at.line.slice(0, at.cursor);
      if (typed !== muted.current) muted.current = null;
      if (typed === asked.current) return;
      asked.current = typed;

      if (muted.current !== null) return;

      // An empty prompt is not a question.
      if (typed.trim() === "") {
        close();
        return;
      }

      const mine = ++turn.current;
      void getPlatform()
        .complete.suggest(at.line, at.cursor, term.cwd(), LIMIT)
        .then((found: Completions) => {
          // A newer keystroke has already asked. Drawing this would answer a
          // question that is no longer on screen.
          if (mine !== turn.current) return;
          setState({
            items: found.items,
            index: 0,
            word: found.word,
            open: found.items.length > 0,
          });
        })
        .catch(() => close());
    }

    const timer = setInterval(look, POLL_MS);
    return () => clearInterval(timer);
  }, [term, active, close]);

  const accept = useCallback(
    (item?: Suggestion) => {
      const chosen = item ?? view.current.items[view.current.index];
      if (!chosen) return false;

      const at = term.promptInput();
      if (!at) return false;

      // Already typed. Nothing to put on the prompt, and saying so lets the
      // caller give the keystroke back to the shell.
      const replacing = at.line.slice(chosen.from, at.cursor);
      if (replacing === chosen.value) {
        close();
        return false;
      }

      term.replaceRange(chosen.from, at.cursor, chosen.value);

      // Forget what was asked, so the next poll sees the accepted text as a
      // change and offers what can follow it — which is what makes Tab twice
      // walk down a directory tree.
      asked.current = "";
      setState((s) => ({ ...s, open: false, items: [] }));
      term.focus();
      return true;
    },
    [term, close],
  );

  const dismiss = useCallback(() => {
    const at = term.promptInput();
    // Stay closed until the prompt changes. An Escape that reopened on the
    // next poll would be a key that does nothing.
    muted.current = at ? at.line.slice(0, at.cursor) : "";
    close();
    term.focus();
  }, [term, close]);

  const move = useCallback((delta: number) => {
    setState((s) => {
      if (s.items.length === 0) return s;
      // Wraps: a list this short is faster to cycle than to bound.
      return { ...s, index: (s.index + delta + s.items.length) % s.items.length };
    });
  }, []);

  const select = useCallback((index: number) => {
    setState((s) => (index >= 0 && index < s.items.length ? { ...s, index } : s));
  }, []);

  return { ...state, accept, dismiss, move, select };
}
