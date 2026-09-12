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
   * Take the selected suggestion, or the one given, and close the list.
   *
   * Answers whether it actually put anything on the prompt. False means the
   * suggestion was already what is typed, so the caller can let the keystroke
   * through rather than swallowing it to do nothing.
   */
  accept: (item?: Suggestion) => boolean;
  dismiss: () => void;
  /**
   * Move the highlight, and put what is now highlighted on the prompt.
   *
   * Moving writes. That is the whole design: nothing reaches your line that
   * you did not move onto, and Enter runs exactly the text you can see.
   */
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
   * The suggestion `move` has already put on the prompt.
   *
   * Needed because writing is not instant: `replaceRange` sends keystrokes to
   * the pty and the shell echoes them back a moment later, so reading the
   * prompt straight afterwards still shows the old text. Accepting what was
   * just previewed would write it a second time, and `ls` + `lsblk` would
   * become `lslsblk`. Remembering beats re-reading.
   */
  const shown = useRef<Suggestion | null>(null);

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
    shown.current = null;
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
      // The prompt moved for a reason other than a preview: whatever was
      // previewed is no longer what is there.
      asked.current = typed;
      shown.current = null;

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

  /**
   * Put a suggestion on the prompt, replacing the word being completed.
   *
   * Answers whether anything changed. The range starts at the suggestion's
   * own `from` — the start of the word — so writing a second suggestion over
   * a first one replaces it rather than appending to it.
   */
  const put = useCallback(
    (chosen: Suggestion): boolean => {
      const at = term.promptInput();
      if (!at) return false;

      // Already exactly what is typed. Nothing to write, and saying so lets
      // the caller hand the keystroke back.
      if (at.line.slice(chosen.from, at.cursor) === chosen.value) return false;

      term.replaceRange(chosen.from, at.cursor, chosen.value);
      shown.current = chosen;
      return true;
    },
    [term],
  );

  const accept = useCallback(
    (item?: Suggestion) => {
      const chosen = item ?? view.current.items[view.current.index];
      if (!chosen) return false;

      // Already on the prompt because moving put it there. The list closes
      // and the keystroke is spent, but nothing is typed again — the shell
      // may not have echoed the first write yet, and re-reading the prompt
      // to check would see the text from before it.
      const previewed = shown.current;
      if (previewed && previewed.from === chosen.from && previewed.value === chosen.value) {
        asked.current = "";
        setState((s) => ({ ...s, open: false, items: [] }));
        shown.current = null;
        term.focus();
        return true;
      }

      if (!put(chosen)) {
        close();
        return false;
      }

      // Forget what was asked, so the next poll sees the accepted text as a
      // change and offers what can follow it — which is what makes Tab twice
      // walk down a directory tree.
      asked.current = "";
      setState((s) => ({ ...s, open: false, items: [] }));
      term.focus();
      return true;
    },
    [term, close, put],
  );

  const dismiss = useCallback(() => {
    const at = term.promptInput();
    // Stay closed until the prompt changes. An Escape that reopened on the
    // next poll would be a key that does nothing.
    muted.current = at ? at.line.slice(0, at.cursor) : "";
    close();
    term.focus();
  }, [term, close]);

  const move = useCallback(
    (delta: number) => {
      const { items, index } = view.current;
      if (items.length === 0) return;

      // Wraps: a list this short is faster to cycle than to bound.
      const next = (index + delta + items.length) % items.length;
      const chosen = items[next];
      setState((s) => ({ ...s, index: next }));

      // Written outside the updater, for the reason `view` exists: a side
      // effect inside one runs twice under StrictMode, and this one types
      // into a real shell.
      if (put(chosen)) {
        // The prompt now says what the poll would otherwise read as a change
        // and answer with a different list — which would move the highlight
        // out from under the arrow key that just moved it. Telling the poll
        // this text is already accounted for is what keeps the list still
        // while you walk down it.
        const at = term.promptInput();
        if (at) asked.current = at.line.slice(0, at.cursor);
      }
      term.focus();
    },
    [term, put],
  );

  const select = useCallback((index: number) => {
    setState((s) => (index >= 0 && index < s.items.length ? { ...s, index } : s));
  }, []);

  return { ...state, accept, dismiss, move, select };
}
