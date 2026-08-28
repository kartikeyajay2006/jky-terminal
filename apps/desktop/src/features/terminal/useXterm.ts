import { useEffect, useRef, useState } from "react";
import { Terminal as Xterm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SerializeAddon } from "@xterm/addon-serialize";
import { decodeGamePayload, useOpenGame } from "../games/openStore";
import { decodeAskPayload, useAsk } from "../../app/askStore";
import { getPlatform } from "../../platform";
import { buildBanner } from "./banner";
import { copyText, readText } from "./clipboard";
import type { SearchHits } from "./TerminalSearch";

/** What a mounted terminal lets the surrounding UI do to it. */
export interface TerminalControls {
  search: (query: string) => void;
  findNext: () => void;
  findPrevious: () => void;
  clearSearch: () => void;
  hits: SearchHits;
  /** The current selection, or "" when nothing is selected. */
  selection: () => string;
  copySelection: () => Promise<boolean>;
  paste: () => Promise<boolean>;
  clear: () => void;
  focus: () => void;
}

const NO_HITS: SearchHits = { current: 0, total: 0 };

/**
 * Owns one xterm instance bound to one pty session.
 *
 * Everything here is lifecycle: create the terminal, attach it to the DOM,
 * spawn a pty, pipe both directions, and tear all of it down exactly once.
 *
 * It also hands back the handful of operations the chrome around it needs —
 * find, copy, paste, clear — because those all require the live xterm
 * instance, which never leaves this hook.
 */
export function useXterm(
  container: React.RefObject<HTMLDivElement | null>,
  /**
   * The key this terminal's scrollback is saved under — its tab id.
   *
   * Omitted, nothing is saved or restored, which is what the tests that do
   * not care about persistence want.
   */
  scrollbackKey?: string,
): TerminalControls {
  const term = useRef<Xterm | null>(null);
  const searchAddon = useRef<SearchAddon | null>(null);
  const ptyRef = useRef<string | null>(null);
  const [hits, setHits] = useState<SearchHits>(NO_HITS);

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let ptyId: string | null = null;

    const xterm = new Xterm({
      fontFamily:
        getComputedStyle(document.documentElement).getPropertyValue("--font-mono") ||
        "monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
    });
    term.current = xterm;

    const fit = new FitAddon();
    xterm.loadAddon(fit);

    const serialize = new SerializeAddon();
    xterm.loadAddon(serialize);

    const search = new SearchAddon();
    xterm.loadAddon(search);
    searchAddon.current = search;

    // Reported by the addon rather than counted here: it owns the match set,
    // and a second count would drift from the one being highlighted.
    search.onDidChangeResults((results) => {
      setHits(
        results && results.resultCount > 0
          ? { current: results.resultIndex + 1, total: results.resultCount }
          : NO_HITS,
      );
    });

    // URLs in output become clickable. Opened through the platform rather
    // than `window.open`, so the CSP that forbids the webview reaching any
    // external host stays intact — the open happens in the OS, not here.
    xterm.loadAddon(
      new WebLinksAddon((_event, uri) => {
        void getPlatform().openExternal(uri);
      }),
    );

    xterm.open(node);

    // WebGL is the fast path but is unavailable on some drivers and in every
    // headless environment. Falling back to the DOM renderer is correct;
    // failing to start a terminal over it is not.
    try {
      xterm.loadAddon(new WebglAddon());
    } catch {
      /* DOM renderer remains in use */
    }

    try {
      fit.fit();
    } catch {
      /* container not measurable yet; the resize observer will retry */
    }

    // Copy-on-select, the way every terminal emulator behaves. Guarded on the
    // selection being non-empty so that a plain click, which clears the
    // selection, does not wipe the clipboard.
    const selectionSub = xterm.onSelectionChange(() => {
      const text = xterm.getSelection();
      if (text) void copyText(text);
    });

    const tokens = getComputedStyle(document.documentElement);
    const banner = buildBanner({
      cols: xterm.cols,
      version: typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "0.1.0",
      palette: {
        accent: tokens.getPropertyValue("--accent"),
        violet: tokens.getPropertyValue("--violet"),
        magenta: tokens.getPropertyValue("--magenta"),
      },
    });
    // `jky ask <question>` in the shell emits OSC 1337 carrying a base64
    // question. Handling it here means the shell command needs no socket, no
    // port, and no knowledge of where the app is — the sequence simply rides
    // the pty like any other output.
    xterm.parser.registerOscHandler(1337, (payload) => {
      const question = decodeAskPayload(payload);
      if (question) {
        useAsk.getState().ask(question);
        // Returning true consumes it, so the escape sequence never reaches
        // the screen as stray characters.
        return true;
      }

      // `jky games <n>` rides the same code, carrying a game to open.
      const game = decodeGamePayload(payload);
      if (game) {
        useOpenGame.getState().open(game);
        return true;
      }

      return false;
    });

    const platform = getPlatform();

    void (async () => {
      // Last session's output first, then a rule, then this session's banner.
      // In that order the scrollback reads as a history rather than as a
      // terminal that mysteriously already has text in it.
      if (scrollbackKey) {
        try {
          const previous = await platform.scrollback.load(scrollbackKey);
          if (previous && !cancelled) {
            xterm.write(previous.endsWith("\n") ? previous : `${previous}\r\n`);
            xterm.write(`\x1b[2m${"─".repeat(Math.max(8, xterm.cols - 2))}\x1b[0m\r\n`);
          }
        } catch {
          // A terminal that will not open because its history could not be
          // read would be a poor trade for a convenience.
        }
      }
      if (cancelled) return;

      // Greet before the shell speaks. Written into the pty stream rather
      // than overlaid, so it lives in the scrollback like a real MOTD, and
      // coloured from the live theme tokens so it follows the active theme.
      xterm.write(banner);

      // The same banner goes to the backend, which stores it so the
      // `jky-terminal` shell command can reprint exactly what was shown.
      const id = await platform.pty.spawn(
        xterm.cols,
        xterm.rows,
        banner,
        tokens.getPropertyValue("--accent"),
      );
      if (cancelled) {
        // StrictMode unmounted us mid-spawn. Kill it rather than leaking a
        // shell process for the lifetime of the app.
        void platform.pty.kill(id);
        return;
      }
      ptyId = id;
      ptyRef.current = id;

      // Order matters. Subscribe first, then attach: the shell prints its
      // prompt the moment output starts flowing, and attaching before the
      // listener existed is what made the first prompt disappear.
      unlisten = await platform.pty.onData(id, (chunk) => xterm.write(chunk));
      xterm.onData((data) => void platform.pty.write(id, data));
      await platform.pty.attach(id);

      // Push the settled size, unconditionally.
      //
      // spawn() was given whatever fit() measured before layout had settled,
      // which can still be the 80x24 default. The ResizeObserver fires once on
      // observe() — but that happens while this spawn is still in flight, so
      // ptyId is null and its resize is skipped. If the pane is never resized
      // again the observer never fires again either, and the shell keeps
      // believing the terminal is a size it is not. Anything drawing on the
      // bottom row is then clipped.
      try {
        fit.fit();
      } catch {
        /* not measurable; the observer will correct it on the next layout */
      }
      await platform.pty.resize(id, xterm.cols, xterm.rows);
    })();

    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ptyId) void platform.pty.resize(ptyId, xterm.cols, xterm.rows);
    });
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      selectionSub.dispose();
      unlisten?.();

      // Serialised before dispose, because dispose takes the buffer with it.
      // Fire-and-forget: the write is bounded and capped in Rust, and holding
      // teardown open for it would stall closing a tab.
      if (scrollbackKey) {
        try {
          const text = serialize.serialize();
          if (text.trim()) void platform.scrollback.save(scrollbackKey, text);
        } catch {
          /* a terminal that fails to save its history still closes */
        }
      }

      if (ptyId) void platform.pty.kill(ptyId);
      xterm.dispose();
      term.current = null;
      searchAddon.current = null;
      ptyRef.current = null;
    };
  }, [container, scrollbackKey]);

  // The query has to survive between typing in the box and pressing next;
  // the addon does not remember it for us.
  const lastQuery = useRef("");

  // Held in a ref so the object identity is stable: every method reaches
  // through refs, so a consumer's effects do not re-run each time the search
  // count ticks.
  const controls = useRef<TerminalControls>(null as unknown as TerminalControls);
  if (controls.current === null) {
    controls.current = {
      hits: NO_HITS,
      search(query) {
        lastQuery.current = query;
        if (!query) {
          searchAddon.current?.clearDecorations();
          setHits(NO_HITS);
          return;
        }
        searchAddon.current?.findNext(query, {
          incremental: true,
          decorations: DECORATIONS,
        });
      },
      findNext() {
        if (lastQuery.current) {
          searchAddon.current?.findNext(lastQuery.current, { decorations: DECORATIONS });
        }
      },
      findPrevious() {
        if (lastQuery.current) {
          searchAddon.current?.findPrevious(lastQuery.current, {
            decorations: DECORATIONS,
          });
        }
      },
      clearSearch() {
        lastQuery.current = "";
        searchAddon.current?.clearDecorations();
        setHits(NO_HITS);
      },
      selection: () => term.current?.getSelection() ?? "",
      async copySelection() {
        const text = term.current?.getSelection() ?? "";
        return text ? copyText(text) : false;
      },
      async paste() {
        const text = await readText();
        const id = ptyRef.current;
        if (!text || !id) return false;
        await getPlatform().pty.write(id, text);
        return true;
      },
      clear: () => term.current?.clear(),
      focus: () => term.current?.focus(),
    };
  }

  // The only field that changes between renders.
  controls.current.hits = hits;

  return controls.current;
}

/**
 * How matches are marked.
 *
 * Token values read at call time rather than hard-coded, so the highlight
 * follows whichever of the seven themes is active — a literal colour here
 * would be a lint error and would also be wrong in six of them.
 */
const DECORATIONS = {
  get matchBackground() {
    return readToken("--accent-dim") || "#00a3b5";
  },
  get activeMatchBackground() {
    return readToken("--accent") || "#00e5ff";
  },
  get matchOverviewRuler() {
    return readToken("--accent-dim") || "#00a3b5";
  },
  get activeMatchColorOverviewRuler() {
    return readToken("--accent") || "#00e5ff";
  },
};

function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
