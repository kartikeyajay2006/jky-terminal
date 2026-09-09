import { useEffect, useRef } from "react";
import type { Suggestion, SuggestionKind } from "../../../platform";
import "./Suggestions.css";

/**
 * A glyph per source, so what a row is can be seen rather than read.
 *
 * Text rather than icons, like the rail: no extra asset, and it themes for
 * free.
 */
const GLYPHS: Record<SuggestionKind, string> = {
  directory: "▸",
  file: "·",
  executable: "$",
  flag: "-",
  branch: "⑂",
  script: "▶",
  history: "↺",
};

const NAMES: Record<SuggestionKind, string> = {
  directory: "directory",
  file: "file",
  executable: "program",
  flag: "flag",
  branch: "branch",
  script: "script",
  history: "from history",
};

interface SuggestionsProps {
  items: Suggestion[];
  index: number;
  /** The matched prefix, drawn apart from the rest. */
  word: string;
  onAccept: (item: Suggestion) => void;
  onSelect: (index: number) => void;
}

/**
 * What could come next.
 *
 * Not focusable, and deliberately so: focus belongs to the terminal, and a
 * list that took it would mean every completion cost a trip back. The keys
 * are claimed from xterm instead — see `claimKeys`.
 */
export function Suggestions({ items, index, word, onAccept, onSelect }: SuggestionsProps) {
  const list = useRef<HTMLUListElement>(null);

  // Keep the selected row in view when the arrows walk past the edge.
  useEffect(() => {
    list.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index]);

  return (
    <div className="suggest" role="presentation">
      <ul
        ref={list}
        className="suggest__list"
        // Announced rather than focused: the terminal keeps the keyboard, so
        // assistive technology is told what is selected instead of being
        // moved to it.
        role="listbox"
        aria-label="Completions"
        aria-activedescendant={items[index] ? `suggest-${index}` : undefined}
        tabIndex={-1}
      >
        {items.map((item, at) => (
          <li
            key={`${item.kind}:${item.value}`}
            id={`suggest-${at}`}
            role="option"
            aria-selected={at === index}
            className="suggest__row"
            data-selected={at === index ? "true" : undefined}
            onMouseEnter={() => onSelect(at)}
            // Mouse *down*, not click: a click lands after the terminal has
            // already taken focus back, and the row would be gone by then.
            onMouseDown={(e) => {
              e.preventDefault();
              onAccept(item);
            }}
          >
            <span className="suggest__glyph" aria-hidden="true">
              {GLYPHS[item.kind]}
            </span>
            <span className="suggest__value">
              <Matched text={item.display} prefix={word} />
            </span>
            {item.detail && <span className="suggest__detail">{item.detail}</span>}
            <span className="suggest__kind">{NAMES[item.kind]}</span>
          </li>
        ))}
      </ul>
      <p className="suggest__keys" aria-hidden="true">
        <kbd>Tab</kbd> accept · <kbd>↑</kbd><kbd>↓</kbd> choose · <kbd>Esc</kbd> dismiss
      </p>
    </div>
  );
}

/**
 * The part that matched, marked.
 *
 * Case-insensitively, because the match was: typing `re` and having `README`
 * show nothing marked would look like the wrong row.
 */
function Matched({ text, prefix }: { text: string; prefix: string }) {
  const at = prefix ? text.toLowerCase().indexOf(prefix.toLowerCase()) : -1;
  if (at === -1) return <>{text}</>;

  return (
    <>
      {text.slice(0, at)}
      <b className="suggest__hit">{text.slice(at, at + prefix.length)}</b>
      {text.slice(at + prefix.length)}
    </>
  );
}
