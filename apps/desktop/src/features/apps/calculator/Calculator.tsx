import { useState, type KeyboardEvent } from "react";
import { calculate, formatResult } from "./calculate";

/**
 * A key on the pad.
 *
 * `label` is what is drawn and `insert` what is typed, because the two differ
 * for exactly the operators people expect to see: × and ÷ are the signs a
 * calculator shows, `*` and `/` are what the parser reads.
 */
interface Key {
  label: string;
  /** Accessible name, when the glyph alone would not say what the key does. */
  name?: string;
  insert?: string;
  action?: "clear" | "backspace" | "equals";
  /** Grid columns to span. */
  span?: number;
  tone?: "operator" | "control" | "commit";
}

const KEYS: Key[] = [
  { label: "C", name: "Clear", action: "clear", tone: "control" },
  { label: "⌫", name: "Backspace", action: "backspace", tone: "control" },
  { label: "(", insert: "(", tone: "operator" },
  { label: ")", insert: ")", tone: "operator" },
  { label: "%", insert: "%", tone: "operator" },

  { label: "7", insert: "7" },
  { label: "8", insert: "8" },
  { label: "9", insert: "9" },
  { label: "÷", name: "Divide", insert: "/", tone: "operator" },
  { label: "^", name: "Power", insert: "^", tone: "operator" },

  { label: "4", insert: "4" },
  { label: "5", insert: "5" },
  { label: "6", insert: "6" },
  { label: "×", name: "Multiply", insert: "*", tone: "operator" },
  { label: "−", name: "Subtract", insert: "-", tone: "operator" },

  { label: "1", insert: "1" },
  { label: "2", insert: "2" },
  { label: "3", insert: "3" },
  { label: ".", insert: "." },
  { label: "+", name: "Add", insert: "+", tone: "operator" },

  { label: "0", insert: "0" },
  { label: "=", name: "Equals", action: "equals", span: 4, tone: "commit" },
];

interface Entry {
  id: number;
  source: string;
  value: number;
}

/**
 * The Calculator app.
 *
 * Arithmetic is done by `calculate`, a real parser rather than `eval` — see
 * the note at the top of that module for why that is a security decision.
 *
 * The answer previews as you type instead of waiting for `=`. A calculator
 * that stays blank until you commit makes you press a key to find out whether
 * you typed what you meant, and the preview costs a parse of a string that is
 * never more than a line long.
 */
export function Calculator() {
  const [source, setSource] = useState("");
  const [history, setHistory] = useState<Entry[]>([]);
  const [nextId, setNextId] = useState(1);

  const result = calculate(source);
  const answer = result.ok && result.value !== null ? formatResult(result.value) : "";
  // An error is worth showing only once there is something to be wrong about:
  // a half-typed "2+" is not a mistake, it is a person still typing.
  const problem = !result.ok && source.trim() !== "" ? result.error : "";

  function commit() {
    const current = calculate(source);
    // Nothing to keep: the history's whole value is that every line in it had
    // an answer, so an unfinished expression stays in the field to be fixed.
    if (!current.ok) return;
    // Bound to a local because the narrowing above does not survive into the
    // updater below — TypeScript cannot know `current` is unchanged by then.
    const value = current.value;
    if (value === null) return;
    setHistory((past) => [{ id: nextId, source: source.trim(), value }, ...past]);
    setNextId((n) => n + 1);
    setSource("");
  }

  function press(key: Key) {
    if (key.action === "clear") return setSource("");
    if (key.action === "backspace") return setSource((s) => s.slice(0, -1));
    if (key.action === "equals") return commit();
    if (key.insert) setSource((s) => s + key.insert);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commit();
  }

  return (
    <div className="calc">
      <div className="calc__display">
        <input
          className="calc__input"
          aria-label="Expression"
          value={source}
          spellCheck={false}
          autoComplete="off"
          placeholder="2 + 2"
          onChange={(e) => setSource(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <output className="calc__answer" role="status" data-error={problem ? "" : undefined}>
          {problem || answer}
        </output>
      </div>

      <div className="calc__pad">
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            className="calc__key"
            data-tone={key.tone}
            style={key.span ? { gridColumn: `span ${key.span}` } : undefined}
            aria-label={key.name}
            onClick={() => press(key)}
          >
            {key.label}
          </button>
        ))}
      </div>

      {history.length > 0 && (
        <ol className="calc__history" aria-label="History">
          {history.map((entry) => (
            <li key={entry.id}>
              {/* Clicking puts the answer back in the field, which is how a
                  result becomes the start of the next sum without retyping. */}
              <button
                type="button"
                className="calc__entry"
                onClick={() => setSource(formatResult(entry.value))}
              >
                <span className="calc__entry-source">{entry.source}</span>
                <span className="calc__entry-value">{formatResult(entry.value)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
