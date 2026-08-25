import { useCallback, useEffect, useId, useRef, useState } from "react";
import "./Select.css";

export interface SelectOption {
  value: string;
  label: string;
  note?: string;
}

const TYPEAHEAD_WINDOW_MS = 1000;

/**
 * Prefix match first, since that is what a user expects from a listbox.
 * Fall back to a substring match on the label and then the value, because
 * option labels here often share a prefix — every Anthropic model begins
 * "Claude", so prefix-only search could never reach the second one.
 */
function findMatch(options: SelectOption[], query: string): number {
  const q = query.toLowerCase();
  const byPrefix = options.findIndex((o) => o.label.toLowerCase().startsWith(q));
  if (byPrefix >= 0) return byPrefix;
  const byLabel = options.findIndex((o) => o.label.toLowerCase().includes(q));
  if (byLabel >= 0) return byLabel;
  return options.findIndex((o) => o.value.toLowerCase().includes(q));
}

interface SelectProps {
  id?: string;
  label: string;
  value: string;
  options: SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

/**
 * A listbox that looks the same on macOS, Windows and Linux.
 *
 * A native <select> renders its popup with the OS widget, which ignores the
 * app's palette: on a light system the options come back as light text on a
 * white popup, i.e. invisible. It also looks different on every platform,
 * which a cross-platform app cannot accept.
 *
 * Implements the ARIA listbox keyboard contract: Up/Down/Home/End move,
 * Enter/Space select, Escape closes, and typing jumps to a matching option.
 */
export function Select({ id, label, value, options, disabled, onChange }: SelectProps) {
  const generatedId = useId();
  const triggerId = id ?? generatedId;
  const listId = `${triggerId}-list`;

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typeahead = useRef({ buffer: "", at: 0 });

  const selectedIndex = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const selected = options[selectedIndex];

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) rootRef.current?.querySelector("button")?.focus();
  }, []);

  const commit = useCallback(
    (index: number) => {
      const option = options[index];
      if (option) onChange(option.value);
      close();
    },
    [options, onChange, close],
  );

  // Clicking anywhere outside dismisses, matching every native popup.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keep the active option in view when arrowing through a long list.
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex]);

  function openList() {
    setActiveIndex(selectedIndex);
    setOpen(true);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        close();
        return;
      case "Tab":
        setOpen(false);
        return;
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        return;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        return;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        return;
      case "End":
        e.preventDefault();
        setActiveIndex(options.length - 1);
        return;
      case "Enter":
        e.preventDefault();
        commit(activeIndex);
        return;
      case " ":
        // Space selects, but only when no search is in progress. Model names
        // contain spaces ("Claude Opus 5"), so committing mid-search would
        // make anything past the first word untypeable.
        if (Date.now() - typeahead.current.at > TYPEAHEAD_WINDOW_MS) {
          e.preventDefault();
          commit(activeIndex);
          return;
        }
        break;
    }

    // Typeahead: consecutive keystrokes within the window build a search string.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const now = Date.now();
      const t = typeahead.current;
      t.buffer = now - t.at > TYPEAHEAD_WINDOW_MS ? e.key : t.buffer + e.key;
      t.at = now;

      const match = findMatch(options, t.buffer);
      if (match >= 0) setActiveIndex(match);
    }
  }

  return (
    <div className="sel" ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        className="sel__trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={onKeyDown}
      >
        <span className="sel__value">{selected?.label ?? value}</span>
        {selected?.note && <span className="sel__note">{selected.note}</span>}
        <span className="sel__caret" aria-hidden="true">
          ▼
        </span>
      </button>

      {open && (
        <ul
          className="sel__list"
          id={listId}
          role="listbox"
          aria-label={label}
          ref={listRef}
        >
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === activeIndex}
              className="sel__opt"
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => commit(i)}
            >
              <span className="sel__opt-label">{o.label}</span>
              {o.note && <span className="sel__opt-note">{o.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
