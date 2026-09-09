import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getPlatform, type HistoryHit } from "../../platform";
import { useTabs } from "../../app/tabStore";
import { requestType } from "../terminal/typeEvent";
import { useNav } from "../../app/navStore";
import "./History.css";

/**
 * Every command you have run, and how to find it again.
 *
 * The search box is the whole feature. Ranking happens in Rust — tightness,
 * frequency and recency — so this asks a question and draws the answer,
 * rather than being handed everything and sorting it in a window.
 */
export function History() {
  const [text, setText] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [hits, setHits] = useState<HistoryHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const box = useRef<HTMLInputElement>(null);

  const look = useCallback(async (query: string, failed: boolean) => {
    try {
      setHits(await getPlatform().history.search({ text: query, failedOnly: failed, limit: 200 }));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  // Debounced, because every keystroke reads the whole file. A hundred
  // thousand entries is a few megabytes and fast, but not fast enough to do
  // between two letters typed quickly.
  useEffect(() => {
    const timer = setTimeout(() => void look(text, failedOnly), 90);
    return () => clearTimeout(timer);
  }, [text, failedOnly, look]);

  useEffect(() => {
    box.current?.focus();
  }, []);

  const total = useMemo(() => hits.reduce((sum, hit) => sum + hit.count, 0), [hits]);

  async function forget(command: string) {
    await getPlatform().history.forget(command);
    await look(text, failedOnly);
  }

  /**
   * Put a command on the prompt of the terminal that has focus.
   *
   * Typed, not run — the same rule the command panels follow. A history that
   * executed what you clicked would be a history you had to be careful in,
   * and the whole point is to be able to browse it.
   */
  function useIt(command: string) {
    const { tabs, activeId } = useTabs.getState();
    const tab = tabs.find((t) => t.id === activeId) ?? tabs[0];
    if (!tab) return;
    useTabs.getState().focusPane(tab.id, tab.focusedPane);
    // Onto the terminal section as well, or the command lands on a prompt
    // behind the panel that was asked to put it there.
    useNav.getState().go("terminal");
    requestType({ pane: tab.focusedPane, text: command });
  }

  return (
    <div className="board history">
      {/* The board head every top-level section wears: an eyebrow that counts
          what is here, the name, and a line saying what it is for. The count
          sits on the left rather than the right because the camera and the
          notification tray are pinned to the top-right corner of the window,
          and anything put there is read through them. */}
      <header className="board__head">
        <p className="board__eyebrow">
          {busy ? (
            <span>reading…</span>
          ) : (
            <>
              <span>
                <b>{hits.length}</b> commands
              </span>
              <span aria-hidden="true">·</span>
              <span>{total} runs</span>
            </>
          )}
        </p>
        <h1 className="board__title">History</h1>
        <p className="board__lede">
          Every command you have run, on this machine and on any you connected
          to. Type the letters you remember — <code>dkrps</code> finds{" "}
          <code>docker ps</code>. Choosing one puts it on the prompt; it does
          not run it.
        </p>
      </header>

      <div className="history__controls">
        <input
          ref={box}
          type="search"
          className="history__search"
          placeholder="dkrps finds docker ps…"
          aria-label="Search command history"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="history__toggle">
          <input
            type="checkbox"
            checked={failedOnly}
            onChange={(e) => setFailedOnly(e.target.checked)}
          />
          Only what failed
        </label>
      </div>

      {error && (
        <p className="history__error" role="alert">
          {error}
        </p>
      )}

      {!busy && hits.length === 0 && (
        <p className="history__empty">
          {text
            ? `Nothing matching “${text}”.`
            : "Nothing yet. Commands are recorded as you run them."}
        </p>
      )}

      <ul className="history__list">
        {hits.map((hit) => (
          <li key={hit.command} className="history__row" data-failed={hit.code !== 0 || undefined}>
            <button
              type="button"
              className="history__command"
              title="Put this on the prompt"
              onClick={() => useIt(hit.command)}
            >
              {hit.command}
            </button>
            <span className="history__meta">
              {hit.host && <span className="history__host">{hit.host}</span>}
              <span className="history__cwd" title={hit.cwd}>
                {hit.cwd}
              </span>
              {hit.count > 1 && <span className="history__runs">×{hit.count}</span>}
              {hit.code !== 0 && <span className="history__code">exit {hit.code}</span>}
              <span className="history__when">{when(hit.last_at)}</span>
            </span>
            <button
              type="button"
              className="history__forget"
              // Every run of it, not the row being looked at. Someone
              // removing a line with a credential in it means all of them.
              aria-label={`Forget every run of ${hit.command}`}
              onClick={() => void forget(hit.command)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How long ago, in the roughest unit that is still true. */
export function when(at: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;

  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;

  return `${Math.round(months / 12)}y ago`;
}
