import { useEffect, useRef, useState } from "react";

export interface SearchHits {
  /** Which hit is highlighted, counting from one. Zero when there are none. */
  current: number;
  total: number;
}

/**
 * The find bar, in the corner of a terminal.
 *
 * Kept deliberately small and non-modal: a terminal's scrollback is the thing
 * you are searching, so covering it with a dialog would hide the answer.
 */
export function TerminalSearch({
  hits,
  onSearch,
  onNext,
  onPrevious,
  onClose,
}: {
  hits: SearchHits;
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);

  // Opening a find bar and having to click it would defeat the shortcut that
  // opened it.
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  function change(value: string) {
    setQuery(value);
    onSearch(value);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    // Handled here rather than on the window: while this is focused these
    // keys belong to the search, and the terminal beneath must not also act
    // on them.
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) onPrevious();
      else onNext();
    }
  }

  const empty = query.length > 0 && hits.total === 0;

  return (
    <div className="tsearch" role="search" aria-label="Search the terminal">
      <span className="tsearch__glyph" aria-hidden="true">
        ⌕
      </span>
      <input
        ref={input}
        className="tsearch__input"
        type="text"
        aria-label="Search terminal output"
        placeholder="Find in terminal"
        value={query}
        data-empty={empty || undefined}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
      />

      <span className="tsearch__count" aria-live="polite">
        {query.length === 0 ? "" : hits.total === 0 ? "no matches" : `${hits.current}/${hits.total}`}
      </span>

      <button
        type="button"
        className="tsearch__btn"
        aria-label="Previous match"
        disabled={hits.total === 0}
        onClick={onPrevious}
      >
        ↑
      </button>
      <button
        type="button"
        className="tsearch__btn"
        aria-label="Next match"
        disabled={hits.total === 0}
        onClick={onNext}
      >
        ↓
      </button>
      <button
        type="button"
        className="tsearch__btn tsearch__btn--close"
        aria-label="Close search"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
