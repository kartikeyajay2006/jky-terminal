import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildCommands, searchText, type PaletteCommand } from "./commands";
import { highlight, rank } from "./match";
import "./Palette.css";

/**
 * How many rows are shown at once.
 *
 * Not a scroll limit — the list scrolls — but a cap on how many are built,
 * since nobody reads past the first handful and the rest is work for nothing.
 */
const MAX_ROWS = 40;

/**
 * The command palette.
 *
 * One box that reaches every section, panel, game and theme in the app. It
 * exists because the app grew: five rail destinations, five dashboard panels,
 * five game views, three settings panels and seven themes are a lot of
 * clicking, and all of it is one or two keystrokes from here.
 */
export function Palette({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // Built once per open rather than per keystroke: the list is static for the
  // lifetime of the palette, and rebuilding it on every character would mean
  // reading the theme table and the tab list on every character too.
  const commands = useMemo(() => buildCommands(), []);

  const results = useMemo(
    () => rank(query, commands, searchText).slice(0, MAX_ROWS),
    [query, commands],
  );

  // A query that narrows the list can leave the cursor past its end.
  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    input.current?.focus();
  }, []);

  // Keep the highlighted row in view when arrowing past the fold.
  useEffect(() => {
    const row = list.current?.children[cursor];
    row?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // A command that needs a line of text, once one has been chosen. The list
  // is replaced by a single prompt rather than opening a dialog on top of a
  // dialog, and Escape steps back to the list rather than out of the palette.
  const [asking, setAsking] = useState<PaletteCommand | null>(null);
  const [answer, setAnswer] = useState("");
  const [askError, setAskError] = useState("");

  const run = useCallback(
    (command: PaletteCommand | undefined) => {
      if (!command) return;
      if (command.ask) {
        setAsking(command);
        setAnswer("");
        return;
      }
      // Closed first, so a command that moves focus is not fighting a panel
      // that is about to unmount.
      onClose();
      command.run?.();
    },
    [onClose],
  );

  // Focus moves to the prompt when one opens, and back to the search when it
  // closes — otherwise the keyboard is left pointing at a hidden input.
  useEffect(() => {
    input.current?.focus();
  }, [asking]);

  async function submitAnswer() {
    const value = answer.trim();
    if (!asking?.ask || !value) return;

    const result = await asking.ask.run(value);
    // Left open on failure. Closing would take the message with it and the
    // only evidence would be that nothing had changed.
    if (result && !result.ok) {
      setAskError(result.message);
      return;
    }
    onClose();
  }

  function onAskKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape" || (e.key === "Backspace" && answer === "")) {
      e.preventDefault();
      setAsking(null);
      setAskError("");
      setQuery("");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      void submitAnswer();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        onClose();
        return;
      case "ArrowDown":
        e.preventDefault();
        setCursor((c) => (results.length === 0 ? 0 : (c + 1) % results.length));
        return;
      case "ArrowUp":
        e.preventDefault();
        setCursor((c) =>
          results.length === 0 ? 0 : (c - 1 + results.length) % results.length,
        );
        return;
      case "Enter":
        e.preventDefault();
        run(results[cursor]?.item);
        return;
      case "Home":
        e.preventDefault();
        setCursor(0);
        return;
      case "End":
        e.preventDefault();
        setCursor(Math.max(0, results.length - 1));
    }
  }

  return (
    <div
      className="pal__backdrop"
      // A click on the dimmed area behind is the other way out. The dialog
      // itself stops the event, so a click inside never closes it.
      onMouseDown={onClose}
    >
      <div
        className="pal"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {asking ? (
          <>
            <div className="pal__bar">
              <span className="pal__asked">{asking.label.replace(/…$/, "")}</span>
              <input
                ref={input}
                className="pal__input"
                type="text"
                aria-label={asking.ask?.placeholder}
                placeholder={asking.ask?.placeholder}
                value={answer}
                onChange={(e) => {
                  setAnswer(e.target.value);
                  setAskError("");
                }}
                aria-invalid={askError ? true : undefined}
                onKeyDown={onAskKeyDown}
              />
              <kbd className="pal__esc">esc</kbd>
            </div>
            {askError ? (
              <p className="pal__error" role="alert">
                {askError}
              </p>
            ) : null}
            <p className="pal__foot">
              <kbd>enter</kbd> to save · <kbd>esc</kbd> to go back
            </p>
          </>
        ) : (
          <>
            <div className="pal__bar">
              <span className="pal__glyph" aria-hidden="true">
                ❯
              </span>
              <input
                ref={input}
                className="pal__input"
                type="text"
                aria-label="Search commands"
                aria-controls="pal-list"
                aria-activedescendant={
                  results[cursor] ? `pal-row-${results[cursor].item.id}` : undefined
                }
                placeholder="Go to a section, play a game, change the theme…"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={onKeyDown}
              />
              <kbd className="pal__esc">esc</kbd>
            </div>

            {results.length === 0 ? (
              <p className="pal__empty">Nothing matches that.</p>
            ) : (
              <ul className="pal__list" id="pal-list" ref={list} role="listbox">
                {results.map((result, i) => (
                  <li
                    key={result.item.id}
                    id={`pal-row-${result.item.id}`}
                    role="option"
                    aria-selected={i === cursor}
                    className="pal__row"
                    data-active={i === cursor || undefined}
                    // Pointer down rather than click: the backdrop closes on
                    // mousedown, so a click would never land.
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      run(result.item);
                    }}
                    onMouseEnter={() => setCursor(i)}
                  >
                    <span className="pal__label">
                      {highlight(result.item.label, result.hits).map((part, n) => (
                        <span key={n} data-hit={part.hit || undefined}>
                          {part.text}
                        </span>
                      ))}
                    </span>
                    <span className="pal__group">{result.item.group}</span>
                    {result.item.hint && <kbd className="pal__hint">{result.item.hint}</kbd>}
                  </li>
                ))}
              </ul>
            )}

            <p className="pal__foot">
              <kbd>↑</kbd>
              <kbd>↓</kbd> to move · <kbd>enter</kbd> to run
            </p>
          </>
        )}
      </div>
    </div>
  );
}
