import { Fragment, useCallback, useEffect, useState } from "react";
import { getPlatform, type MemoryRun } from "../../platform";
import { tookText } from "../terminal/blocks";
import { when } from "./History";
import { typeIt } from "./typeIt";

/**
 * Work Memory: every run, with what it printed, searchable.
 *
 * The commands view answers "what was that command?". This one answers what
 * people actually come back for — the run that printed *that* error, what ran
 * on `release`, how long the migration took, the note on the one that worked.
 * Every word must appear in the command, its output, its note or its folder.
 */
export function Runs() {
  const [text, setText] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [runs, setRuns] = useState<MemoryRun[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const look = useCallback(async (query: string, failed: boolean, pinned: boolean) => {
    try {
      setRuns(await getPlatform().memory.search({ text: query, failedOnly: failed, pinnedOnly: pinned, limit: 200 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void look(text, failedOnly, pinnedOnly), 120);
    return () => clearTimeout(timer);
  }, [text, failedOnly, pinnedOnly, look]);

  async function pin(run: MemoryRun) {
    await getPlatform().memory.pin(run.id, !run.pinned);
    setRuns((all) => all.map((r) => (r.id === run.id ? { ...r, pinned: !r.pinned } : r)));
  }

  async function forget(run: MemoryRun) {
    await getPlatform().memory.forget(run.id);
    setRuns((all) => all.filter((r) => r.id !== run.id));
  }

  async function note(run: MemoryRun, value: string) {
    if (value.trim() === run.note) return;
    await getPlatform().memory.note(run.id, value);
    setRuns((all) => all.map((r) => (r.id === run.id ? { ...r, note: value.trim() } : r)));
  }

  return (
    <div className="runs">
      <div className="history__controls">
        <input
          type="search"
          className="history__search"
          placeholder="a word from the command, its output or a note…"
          aria-label="Search runs and their output"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="history__toggle">
          <input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} />
          Only what failed
        </label>
        <label className="history__toggle">
          <input type="checkbox" checked={pinnedOnly} onChange={(e) => setPinnedOnly(e.target.checked)} />
          Pinned
        </label>
      </div>

      {error && (
        <p className="history__error" role="alert">
          {error}
        </p>
      )}

      {!busy && runs.length === 0 && (
        <p className="history__empty">
          {text ? `No run mentions “${text}”.` : "Nothing yet. Runs are kept as commands finish."}
        </p>
      )}

      {runs.length > 0 && (
      <ul className="runs__list">
        {runs.map((run) => (
          <li key={run.id} className="runs__row" data-failed={run.code !== 0 || undefined} data-pinned={run.pinned || undefined}>
            <div className="runs__head">
              <button
                type="button"
                className="runs__pin"
                aria-pressed={run.pinned}
                aria-label={`${run.pinned ? "Unpin" : "Pin"} ${run.command}`}
                title={run.pinned ? "Pinned: kept first, and through any retention window" : "Pin"}
                onClick={() => void pin(run)}
              >
                {run.pinned ? "★" : "☆"}
              </button>
              <button
                type="button"
                className="history__command"
                title="Put this on the prompt"
                onClick={() => typeIt(run.command)}
              >
                {run.command}
              </button>
              <button
                type="button"
                className="runs__toggle"
                aria-expanded={open === run.id}
                aria-label={`${open === run.id ? "Hide" : "Show"} output of ${run.command}`}
                onClick={() => setOpen(open === run.id ? null : run.id)}
              >
                {open === run.id ? "▾" : "▸"}
              </button>
              <button
                type="button"
                className="history__forget"
                aria-label={`Forget this run of ${run.command}`}
                onClick={() => void forget(run)}
              >
                ×
              </button>
            </div>

            <p className="history__meta runs__meta">
              {run.host && <span className="history__host">{run.host}</span>}
              <span className="history__cwd" title={run.cwd}>
                {run.cwd}
              </span>
              {run.branch && (
                <span className="runs__git">
                  {run.branch}
                  {run.rev && ` @ ${run.rev}`}
                </span>
              )}
              {!run.branch && run.rev && <span className="runs__git">@ {run.rev}</span>}
              {run.code !== 0 && <span className="history__code">exit {run.code}</span>}
              {run.duration_ms !== null && <span className="runs__took">{tookText(run.duration_ms)}</span>}
              <span className="history__when">{when(run.at)}</span>
            </p>

            {run.snippet && open !== run.id && <Snippet text={run.snippet} />}

            {open === run.id && (
              <div className="runs__detail">
                {run.output ? (
                  <pre className="runs__output">{run.output}</pre>
                ) : (
                  <p className="history__empty">Nothing it printed was kept.</p>
                )}
                <textarea
                  className="input runs__note"
                  aria-label="Note on this run"
                  placeholder="What this was for, or why it worked…"
                  maxLength={2000}
                  defaultValue={run.note}
                  onBlur={(e) => void note(run, e.target.value)}
                />
              </div>
            )}
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

/** A line of output or note with the matched words marked. */
function Snippet({ text }: { text: string }) {
  // Rust marks each match as \u0002…\u0003.
  const START = "\u0002";
  const END = "\u0003";
  const parts: Array<{ text: string; marked: boolean }> = [];
  let rest = text;
  while (rest) {
    const open = rest.indexOf(START);
    if (open < 0) {
      parts.push({ text: rest, marked: false });
      break;
    }
    const close = rest.indexOf(END, open + 1);
    if (open > 0) parts.push({ text: rest.slice(0, open), marked: false });
    parts.push({ text: rest.slice(open + 1, close < 0 ? undefined : close), marked: true });
    rest = close < 0 ? "" : rest.slice(close + 1);
  }
  return (
    <p className="runs__snippet">
      {parts.map((part, i) =>
        part.marked ? <mark key={i}>{part.text}</mark> : <Fragment key={i}>{part.text}</Fragment>,
      )}
    </p>
  );
}
