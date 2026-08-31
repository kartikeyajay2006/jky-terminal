import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { getPlatform } from "../../../platform";
import type { BrowserRect } from "../../../platform/types";

/**
 * The site, for showing beside the bar.
 *
 * What a person checks before trusting a page is the host, not the query
 * string, so that is what is shown and the rest is not.
 */
function siteOf(url: string): string {
  const after = url.split("://")[1];
  if (!after) return "";
  return after.split(/[/?#]/)[0] ?? "";
}

/**
 * The Browser app.
 *
 * The page is drawn by a **native child webview**, not an iframe, and not by
 * this component — React only measures where it should sit. Most of the web
 * refuses to be framed (GitHub and Jira answer `X-Frame-Options: deny`;
 * Slack, Notion, Figma, YouTube and Reddit all answer `SAMEORIGIN`), and
 * framing rules govern nested browsing contexts only. A native webview is a
 * top-level one, so it can open pages an iframe cannot.
 *
 * The engine is whatever the operating system already ships — WebKitGTK on
 * Linux, WKWebView on macOS, WebView2 on Windows. Nothing is bundled, so this
 * adds no download size and no memory beyond the page being shown, which is
 * the whole reason it is not Chromium in a box.
 *
 * Three things it deliberately cannot do: call any Tauri command (its webview
 * is labelled `browser` and no capability names that label), keep anything
 * (it is incognito, so cookies and storage live in memory and die with it),
 * and open anything that is not `http` or `https`.
 */
export function Browser() {
  const platform = getPlatform();
  const hosted = platform.browser.available;

  const [address, setAddress] = useState("");
  const [site, setSite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** The hole in the layout the webview is drawn into. */
  const pane = useRef<HTMLDivElement>(null);
  /** Whether a page has been opened, so `place` is not called before one has. */
  const live = useRef(false);

  const rectOf = useCallback((): BrowserRect | null => {
    const box = pane.current?.getBoundingClientRect();
    if (!box || box.width < 1 || box.height < 1) return null;
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  }, []);

  const go = useCallback(
    async (raw: string) => {
      const rect = rectOf();
      if (!rect) return;
      setBusy(true);
      setError(null);
      try {
        const went = await getPlatform().browser.open(raw, rect);
        live.current = true;
        setSite(siteOf(went));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [rectOf],
  );

  // The webview is drawn by the OS and knows nothing about this layout, so
  // every time the hole moves or resizes it has to be told where it went.
  useEffect(() => {
    if (!hosted) return;
    const node = pane.current;
    if (!node) return;

    const reposition = () => {
      if (!live.current) return;
      const rect = rectOf();
      if (rect) void getPlatform().browser.place(rect).catch(() => {});
    };

    const observer = new ResizeObserver(reposition);
    observer.observe(node);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [hosted, rectOf]);

  // A webview left running behind a closed panel is a page still loading,
  // still playing, and still talking to the network.
  useEffect(() => {
    if (!hosted) return;
    return () => {
      live.current = false;
      void getPlatform().browser.close().catch(() => {});
    };
  }, [hosted]);

  if (!hosted) {
    return (
      <div className="br br--unavailable">
        <h2 className="br__title">The browser needs the desktop app</h2>
        <p className="br__body">
          Pages are drawn by a webview the operating system provides, and this preview is
          running in an ordinary browser tab with no window to dock one into. Open JKY
          Terminal itself and this works.
        </p>
      </div>
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void go(address);
  }

  return (
    <div className="br">
      <div className="br__bar">
        <div className="br__nav">
          <button
            type="button"
            className="br__step"
            aria-label="Back"
            onClick={() => void getPlatform().browser.history(-1)}
          >
            ←
          </button>
          <button
            type="button"
            className="br__step"
            aria-label="Forward"
            onClick={() => void getPlatform().browser.history(1)}
          >
            →
          </button>
          <button
            type="button"
            className="br__step"
            aria-label="Reload"
            onClick={() => void getPlatform().browser.history(0)}
          >
            ↻
          </button>
        </div>

        <div className="br__field">
          <input
            className="br__input"
            aria-label="Address"
            value={address}
            spellCheck={false}
            autoComplete="off"
            placeholder="Address, or something to search for"
            onChange={(e) => setAddress(e.target.value)}
            onKeyDown={onKeyDown}
          />
          {site && (
            <span className="br__site" title={site}>
              {site}
            </span>
          )}
        </div>

        <button
          type="button"
          className="br__go"
          disabled={busy || address.trim() === ""}
          onClick={() => void go(address)}
        >
          {busy ? "Opening…" : "Go"}
        </button>
      </div>

      {error && (
        <p className="br__error" role="alert">
          {error}
        </p>
      )}

      {/* The hole the webview is drawn into. It is empty by design: the page
          is not in this document, which is exactly why it cannot reach it. */}
      <div className="br__pane" ref={pane}>
        {!site && !error && (
          <section className="br__empty" aria-label="Private by default">
            <p className="br__empty-title">Private by default</p>
            <p className="br__body">
              Nothing is kept: cookies, storage and history live in memory and are gone when
              you leave this app. Searches go to DuckDuckGo, and pages here cannot reach
              anything else in JKY Terminal.
            </p>
          </section>
        )}
      </div>
    </div>
  );
}
