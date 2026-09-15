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
import { buildBanner, offsetToWordmark, wordmarkLayout } from "./banner";
import { WORDMARK } from "./wordmark";
import { buildEmblem } from "../../components/emblemSvg";
import { terminalColours } from "./termColours";
import { isAppShortcut } from "../../app/shortcuts";
import { overrideBytes } from "./inputKeys";
import { isReal, outputRows, rowsOf, toneOf } from "./blocks";
import { TERM_FONT_EVENT, loadTermFont, stackFor, type TermFont } from "./termFont";
import { copyText, readText } from "./clipboard";
import { dirOf, usePaneDirs } from "./paneDirs";
import { decodeCommand, renderResult } from "./shellCommand";
import { decodeDone, outputOf, type CommandDone } from "./commandFailure";
import { MarkTracker, parseMark, type CommandBlock } from "./marks";
import { useActivity } from "./activity";
import type { Completion } from "./recognise";
import type { Tick } from "./ticks";
import { runShellCommand } from "./runShellCommand";
import type { SearchHits } from "./TerminalSearch";

/** What a mounted terminal lets the surrounding UI do to it. */
/** A block the person clicked on, and where they clicked it. */
export interface BlockPick {
  block: CommandBlock;
  x: number;
  y: number;
}

export interface TerminalControls {
  /**
   * Let a panel take some keys before the shell is sent them.
   *
   * The only place they can be taken. xterm handles a key by calling
   * `stopPropagation`, so a window listener never sees one while a terminal
   * has focus — which is why the offer under a failed command could only be
   * answered with the mouse, and why pressing 1 typed a 1 at the prompt.
   *
   * The handler returns whether it consumed the event. Null gives the keys
   * back, and a panel must do that when it closes.
   */
  claimKeys: (handler: ((event: KeyboardEvent) => boolean) | null) => void;

  /**
   * Put text on the command line, as if it had been typed.
   *
   * Typed, not run: no newline is sent, so the person reads what is about to
   * happen and presses Enter themselves. That is what makes a panel offering
   * `docker stop` something you check rather than something you trust.
   */
  type: (text: string) => void;
  /**
   * The tail of what is on screen, for a request that has been asked for.
   *
   * Read on demand rather than kept, so a terminal nobody asks about never
   * copies its own buffer.
   */
  recentOutput: (lines?: number) => string;
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
  /** Bring one line of the scrollback into view, for the session strip. */
  scrollToLine: (line: number) => void;
  /**
   * Everything one command printed, read out of the scrollback.
   *
   * Empty when the shell never said where its output began: there is no
   * honest answer then, and guessing is what the marks exist to replace.
   */
  blockOutput: (block: CommandBlock) => string;

  /**
   * What is typed at the prompt right now, and where the cursor is in it.
   *
   * Read off the screen rather than accumulated from keystrokes. A model
   * built from what the user pressed goes wrong the first time they recall a
   * line with the up arrow, or the shell rewrites the line itself — and it
   * goes wrong silently, offering completions for a command that is no
   * longer there. The screen is the truth.
   *
   * Null when the prompt's own width is not yet known: see `promptCol`.
   */
  promptInput: () => { line: string; cursor: number } | null;
  /** Where the shell last said it was, for completing a path. */
  cwd: () => string;
  /**
   * Replace part of what is typed.
   *
   * Sent as backspaces and then text, because that is all a pty accepts —
   * there is no way to hand a shell a new line except by typing it.
   */
  replaceRange: (from: number, to: number, text: string) => void;
}

const NO_HITS: SearchHits = { current: 0, total: 0 };

/**
 * The most gutter marks kept at once.
 *
 * The same number of commands `MarkTracker` remembers, deliberately: a mark
 * whose block has been forgotten is a mark that can be clicked and has
 * nothing to say.
 */
const MAX_MARKS = 500;

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
/** How long the light across a new wordmark may take before it is taken down anyway. */
const SWEEP_DEADLINE_MS = 3000;

export function useXterm(
  container: React.RefObject<HTMLDivElement | null>,
  /**
   * The key this terminal's scrollback is saved under — its tab id.
   *
   * Omitted, nothing is saved or restored, which is what the tests that do
   * not care about persistence want.
   */
  scrollbackKey?: string,
  /**
   * Called when the shell reports a command that failed.
   *
   * Kept in a ref rather than a dependency: this effect creates and destroys
   * an xterm and a pty, and re-running it because a handler identity changed
   * would tear down the terminal under the user.
   */
  onFailure?: (failure: CommandDone) => void,
  /**
   * Called when any command finishes, with what it printed.
   *
   * Separate from `onFailure` because they answer different questions: one
   * asks whether to offer help, the other whether the output can be shown as
   * something better than text.
   */
  onDone?: (completion: Completion) => void,
  /**
   * Called with each finished command, for the session strip.
   *
   * Separate from `onDone`, which is about what a command *printed*: this is
   * about when it ran and how long it took, and the two are wanted by
   * different parts of the app.
   */
  onBlock?: (tick: Tick) => void,
  /**
   * A command's gutter mark was clicked.
   *
   * The window decides what to offer; this only says which command and
   * where on screen, because a menu has to open beside the thing it is
   * about and only the terminal knows where that is.
   */
  onPickBlock?: (pick: BlockPick) => void,
  /**
   * A saved host to open this terminal on, rather than a local shell.
   *
   * The id of a host, never a command line: the argument list is built in
   * Rust from what was saved under that id, so nothing the window holds
   * becomes a process argument.
   */
  host?: string,
): TerminalControls {
  const term = useRef<Xterm | null>(null);
  const searchAddon = useRef<SearchAddon | null>(null);
  const ptyRef = useRef<string | null>(null);
  const [hits, setHits] = useState<SearchHits>(NO_HITS);
  const failureHandler = useRef(onFailure);
  failureHandler.current = onFailure;
  const doneHandler = useRef(onDone);
  doneHandler.current = onDone;
  const blockHandler = useRef(onBlock);
  blockHandler.current = onBlock;
  const pickHandler = useRef(onPickBlock);
  pickHandler.current = onPickBlock;
  /**
   * The buffer line the last command's output began after.
   *
   * A command's own output is the region between the previous report and
   * this one, so exactly one number has to be remembered — and remembering
   * it here means never scanning the scrollback for where a command started.
   */
  const mark = useRef(0);
  // Where the shell says each command began and ended. Separate from `mark`
  // above, which is only ever "everything since the last report".
  const marks = useRef(new MarkTracker());

  /**
   * How wide the prompt is, in columns.
   *
   * The shell reports where a prompt *begins* (OSC 133 `A`) but not where it
   * ends — `B` would have to live inside PS1, and rewriting somebody's prompt
   * string risks their line wrapping. So it is measured instead: at the first
   * keystroke after a prompt mark, the cursor is sitting exactly at the end
   * of the prompt. Null until then, and completions wait rather than guess.
   */
  const promptCol = useRef<number | null>(null);
  /** Where the shell last said it was. Reported on every prompt, via OSC 7. */
  const cwd = useRef("");
  /** A panel's key handler, while one is open. See `claimKeys`. */
  const keyClaim = useRef<((event: KeyboardEvent) => boolean) | null>(null);
  /**
   * The gutter marks, one per finished command.
   *
   * Held so they can be disposed: a decoration outlives the terminal that
   * drew it unless somebody says otherwise, and a cleared screen has to take
   * its marks with it or they point at rows that are no longer there.
   */
  const blockMarks = useRef<Array<{ dispose(): void }>>([]);

  useEffect(() => {
    const node = container.current;
    if (!node) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let ptyId: string | null = null;

    const font = loadTermFont();
    // Read live on every call, because the theme can change under a terminal
    // that is already open.
    const readToken = (name: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name);
    const xterm = new Xterm({
      fontFamily: stackFor(font.family),
      fontSize: font.size,
      cursorBlink: true,
      allowProposedApi: true,
      theme: terminalColours(readToken),
    });
    term.current = xterm;

    // Repaint when the theme changes. A terminal opened under one theme and
    // kept under another would otherwise be the one surface still wearing
    // the old colours.
    const themeWatch = new MutationObserver(() => {
      xterm.options.theme = terminalColours(readToken);
    });
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    const fit = new FitAddon();
    xterm.loadAddon(fit);

    /**
     * Draw one command's mark in the gutter.
     *
     * A decoration rather than anything of our own, because a decoration is
     * anchored to a line of the buffer and scrolls with it — a box positioned
     * over the terminal would have to be told about every scroll, resize and
     * reflow, and would be wrong between being told.
     *
     * It sits at column zero and is pulled left into the terminal's own
     * padding by the stylesheet, so it marks the block without covering the
     * first character of what the command printed.
     */
    function markBlock(block: CommandBlock) {
      const xterm = term.current;
      // The first report of a session describes no command: both shells send
      // a status before anything has run.
      if (!xterm || !isReal(block)) return;

      // A marker is relative to the cursor, and the cursor is at the prompt
      // that follows the block — so the offset is backwards from there.
      const back = block.prompt.line - (xterm.buffer.active.baseY + xterm.buffer.active.cursorY);
      const marker = xterm.registerMarker(back);
      if (!marker) return;

      const decoration = xterm.registerDecoration({
        marker,
        anchor: "left",
        x: 0,
        width: 1,
        height: rowsOf(block),
      });
      if (!decoration) {
        marker.dispose();
        return;
      }

      decoration.onRender((element) => {
        element.className = "term__block";
        element.dataset.tone = toneOf(block);
        element.title = block.command
          ? `${block.command}\nClick for what can be done with it.`
          : "Click for what can be done with this command.";
        element.onclick = (event) => {
          event.stopPropagation();
          pickHandler.current?.({ block, x: event.clientX, y: event.clientY });
        };
      });

      blockMarks.current.push(decoration);

      // Bounded, for the same reason and to the same number as the blocks
      // themselves. `MarkTracker` forgets a command once five hundred newer
      // ones exist; without the same limit here a terminal left open all day
      // accumulated a decoration and a marker per command for ever, none of
      // which could be reached once the block behind it had been forgotten.
      while (blockMarks.current.length > MAX_MARKS) {
        blockMarks.current.shift()?.dispose();
      }
    }

    // The app's own shortcuts must reach the window rather than the shell.
    // Without this, xterm handles Ctrl+T itself and calls stopPropagation, so
    // every app shortcut was dead while a terminal had focus — which is most
    // of the time. Returning false makes xterm leave the event alone entirely.
    xterm.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      if (isAppShortcut(event)) return false;
      // A panel's own keys, taken before the shell is sent them. Returning
      // false leaves the event alone entirely, so it still reaches the window
      // — which is why the panels ignore anything coming from in here.
      if (keyClaim.current?.(event)) {
        // Claimed means claimed. Returning false stops xterm handling the
        // key, but xterm only calls preventDefault for keys it handles — so
        // without this the browser went on to do its own thing with it. For
        // Tab that is moving focus to the next control, which took the
        // keyboard out of the terminal and into the status bar's theme
        // picker: press Tab to complete, and you had to click back into the
        // terminal to keep typing.
        //
        // Every key a panel claims has a browser default worth stopping —
        // Tab moves focus, Space and the arrows scroll, Enter submits.
        //
        // This stops the default only. The event still propagates to the
        // window, which the comment above depends on.
        event.preventDefault();
        return false;
      }

      // A key whose terminal answer is older than the question — Shift+Enter,
      // which has meant the same byte as Enter since 1978 and now has to mean
      // "newline" to an assistant reading a paragraph. See `inputKeys`.
      const bytes = overrideBytes(event);
      if (bytes !== null) {
        const id = ptyRef.current;
        if (id) void getPlatform().pty.write(id, bytes);
        event.preventDefault();
        return false;
      }

      return true;
    });

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
    //
    // The `true` is `preserveDrawingBuffer`, and it is what makes the terminal
    // photographable. WebGL is otherwise free to discard a frame the moment it
    // has been drawn, so reading the canvas afterwards — which is exactly what
    // a capture does — finds a blank buffer and does not even throw about it.
    // Measured on WebKitGTK 2.52.5: a 756x1037 terminal serialised to 4KB of
    // transparent PNG. Keeping the buffer costs memory and a little fill rate;
    // a camera that photographs everything except the terminal costs more.
    try {
      xterm.loadAddon(new WebglAddon(true));
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
        ground: tokens.getPropertyValue("--ground"),
      },
    });

    /*
     * The emblem beside the wordmark, and one pass of light across it.
     *
     * Pinned once the banner has been parsed, because a marker is placed
     * relative to the cursor and only then is the cursor where the banner left
     * it. Decorations rather than anything of our own, for the reason the
     * gutter marks give: they scroll, resize and reflow with the line.
     */
    const bannerMarks: Array<{ dispose(): void }> = [];
    let sweepDeadline: ReturnType<typeof setTimeout> | undefined;

    function pinToWordmark(written: string) {
      const layout = wordmarkLayout(xterm.cols);
      if (cancelled || !layout) return;

      const marker = xterm.registerMarker(offsetToWordmark(written));
      if (!marker) return;
      bannerMarks.push(marker);

      if (layout.emblem) {
        const emblem = xterm.registerDecoration({
          marker,
          anchor: "left",
          x: layout.emblem.x,
          width: layout.emblem.width,
          height: WORDMARK.length,
        });
        if (emblem) {
          bannerMarks.push(emblem);
          emblem.onRender((element) => {
            // Called on every render, not once; the emblem is built once.
            if (element.dataset.emblem) return;
            element.dataset.emblem = "on";
            element.classList.add("term__emblem");
            element.append(buildEmblem());
          });
        }
      }

      const sweep = xterm.registerDecoration({
        marker,
        anchor: "left",
        x: layout.wordmark.x,
        width: layout.wordmark.width,
        height: WORDMARK.length,
      });
      if (sweep) {
        bannerMarks.push(sweep);
        sweep.onRender((element) => {
          if (element.dataset.sweep) return;
          element.dataset.sweep = "on";
          element.classList.add("term__sweep");
          element.addEventListener("animationend", () => sweep.dispose(), { once: true });
        });
        // A wordmark scrolled away before it was ever drawn never animates, so
        // the light is taken down on a deadline too rather than waiting for ever.
        sweepDeadline = setTimeout(() => sweep.dispose(), SWEEP_DEADLINE_MS);
      }
    }
    // The shell's semantic marks: where a prompt begins, where a command's
    // output begins, and the status it ended with. This is a shared
    // convention rather than something this app invented — see
    // `crates/jky-pty/src/integration.rs`.
    //
    // Positions are recorded as xterm markers rather than plain line numbers.
    // A number goes stale the moment scrollback overflows and the buffer
    // shifts underneath it; a marker is moved by the terminal itself, so a
    // jump still lands on the right line an hour later.
    // The working directory, on every prompt. A shared convention rather
    // than an invention — see `crates/jky-pty/src/integration.rs`. The
    // completion engine needs it before a command has finished, which is the
    // one thing the completion report cannot provide.
    xterm.parser.registerOscHandler(7, (payload) => {
      // `file://host/path`. The host is whatever the shell felt like saying
      // and is not checked: a path is all that is wanted, and refusing one
      // because the hostname looked odd would break completions on every
      // machine with an unusual `hostname`.
      const path = payload.replace(/^file:\/\/[^/]*/, "");
      if (path.startsWith("/")) {
        cwd.current = decodeURIComponent(path);
        // Reported on every prompt, so this is mostly a no-op — the store
        // writes only when the directory actually changed.
        if (scrollbackKey) usePaneDirs.getState().remember(scrollbackKey, cwd.current);
      }
      return true;
    });

    xterm.parser.registerOscHandler(133, (payload) => {
      const parsed = parseMark(payload);
      if (!parsed) return false;

      const buffer = xterm.buffer.active;
      const here = xterm.registerMarker(0) ?? { line: buffer.baseY + buffer.cursorY };
      const now = Date.now();

      // A fresh prompt: its width is not known again until something is
      // typed at it.
      if (parsed.kind === "prompt") promptCol.current = null;

      if (parsed.kind === "prompt") marks.current.prompt(here, now);
      else if (parsed.kind === "output") marks.current.output(here, now);
      else marks.current.done(here, parsed.exitCode, now);

      // The rest of the app learns what this terminal is doing from here.
      // `C` is the shell saying a command's output is beginning, which is
      // the moment it actually started running; `D` carries how it ended.
      // Both are facts the shell reported, not guesses off the screen.
      if (scrollbackKey) {
        if (parsed.kind === "output") useActivity.getState().started(scrollbackKey);
        else if (parsed.kind === "done") {
          useActivity.getState().finished(scrollbackKey, parsed.exitCode);
        }
      }

      return true;
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

      // The shell's prompt hook, reporting a finished command — every one of
      // them, not only the ones that failed.
      const done = decodeDone(payload);
      if (done) {
        const buffer = xterm.buffer.active;
        const end = buffer.baseY + buffer.cursorY;

        // Everything drawn since the last report: the prompt, the command as
        // it was typed, and then whatever the command printed.
        //
        // `from` is held rather than read back off `mark` below, because the
        // region's first line is this value and `mark` has moved on by then.
        const from = mark.current;
        const region: string[] = [];
        for (let y = from; y < end; y += 1) {
          region.push(buffer.getLine(y)?.translateToString(true) ?? "");
        }
        mark.current = end;

        // Where the output actually started, if the shell said so.
        //
        // `outputOf` finds the boundary by searching the region for the
        // command's own text, which is a good guess that is wrong whenever a
        // command prints something resembling itself — `grep`, `history`,
        // `echo` — or whenever the prompt wrapped. The `C` mark is the shell
        // stating the answer, so prefer it and keep the guess for shells that
        // do not report one.
        const started = marks.current.current?.output?.line ?? null;
        const exact =
          started !== null && started >= from && started <= end
            ? region.slice(started - from)
            : null;

        if (done.code !== 0) failureHandler.current?.(done);

        /*
         * The command this report is about: the one that just finished.
         *
         * Not `latest`, which was wrong and quietly so. bash and zsh emit
         * `D` and the next `A` in a single printf and send the report after
         * both, so by the time it arrives a new block is already open —
         * `latest` returned that one, whose `startedAt` is a moment ago and
         * whose `finishedAt` is null. Every tick on the session strip was
         * therefore timing an empty block and reading as zero.
         *
         * `last` is the most recently *finished* block, which is what the
         * report describes under either ordering: bash and zsh open the next
         * one first, fish does not.
         */
        const block = marks.current.last();
        // Two sequences describe one command: this one says what was typed,
        // the OSC 133 pair says where it sat and how it ended. Joining them
        // here is what lets a block be copied, re-run or asked about.
        marks.current.describe(done.command);
        if (block) markBlock(block);
        blockHandler.current?.({
          id: `${from}-${Date.now()}`,
          command: done.command,
          code: done.code,
          took:
            block?.startedAt != null
              ? Math.max(0, (block.finishedAt ?? Date.now()) - block.startedAt)
              : null,
          line: from,
          at: Date.now(),
        });

        doneHandler.current?.({
          command: done.command,
          code: done.code,
          cwd: done.cwd,
          output: exact ? exact.join("\n").replace(/^\n+|\s+$/g, "") : outputOf(region, done.command),
        });
        return true;
      }

      // The write commands — `jky note new`, `jky todo add` and the rest.
      // Their result is printed straight back onto this terminal, because an
      // escape sequence is one-way and the shell cannot see what happened.
      const command = decodeCommand(payload);
      if (command) {
        void runShellCommand(command)
          .then((result) =>
            xterm.write(
              renderResult(result, tokens.getPropertyValue("--accent")),
            ),
          )
          .catch(() =>
            xterm.write(
              renderResult(
                { ok: false, message: "that could not be done" },
                tokens.getPropertyValue("--accent"),
              ),
            ),
          );
        return true;
      }

      return false;
    });

    const platform = getPlatform();

    void (async () => {
      // Read before spawning, drawn after: whether the old output belongs on
      // screen depends on whether the shell is new. A rejoined shell sends
      // what it printed while nobody watched, and old scrollback above that
      // would show the same session twice.
      let previous = "";
      if (scrollbackKey) {
        try {
          previous = await platform.scrollback.load(scrollbackKey);
        } catch {
          // A terminal that will not open because its history could not be
          // read would be a poor trade for a convenience.
        }
      }
      if (cancelled) return;

      // A remote terminal takes no banner and no accent: both are drawn by
      // this machine's shell integration, and none of that exists at the
      // other end. It is a terminal on somebody else's computer, and it is
      // never held — it cannot outlive the window.
      const spawned = host
        ? {
            id: await platform.remote.spawn(host, xterm.cols, xterm.rows),
            reattached: false,
            survives: false,
          }
        : await platform.pty.spawn(
            xterm.cols,
            xterm.rows,
            banner,
            tokens.getPropertyValue("--accent"),
            // Where this pane was when it was last open. Rust checks the
            // directory still exists before honouring it — a project folder
            // moved or deleted since must not stop a terminal from opening.
            dirOf(scrollbackKey),
            // Which pane this is, so a shell that outlived the window can be
            // found again. Absent, the shell is the window's own.
            scrollbackKey ?? null,
          );
      const id = spawned.id;
      if (cancelled) {
        // Unmounted mid-spawn — StrictMode does this on purpose. Let go rather
        // than end it: a held shell may be exactly what the next mount of this
        // pane is about to rejoin, and one the window owns ends either way.
        void platform.pty.release(id);
        return;
      }

      // Whether quitting would lose what this pane is doing.
      if (scrollbackKey) useActivity.getState().held(scrollbackKey, spawned.survives);

      if (!spawned.reattached) {
        // Last session's output first, then a rule, then this session's
        // banner. In that order the scrollback reads as a history rather than
        // as a terminal that mysteriously already has text in it.
        if (previous) {
          xterm.write(previous.endsWith("\n") ? previous : `${previous}\r\n`);
          xterm.write(`\x1b[2m${"─".repeat(Math.max(8, xterm.cols - 2))}\x1b[0m\r\n`);
        }
        // Greet before the shell speaks. Written into the terminal rather
        // than overlaid, so it lives in the scrollback like a real MOTD, and
        // coloured from the live theme tokens so it follows the active theme.
        // The same banner went to the backend, which stores it so the
        // `jky-terminal` shell command can reprint exactly what was shown.
        if (!host) xterm.write(banner, () => pinToWordmark(banner));
      }
      ptyId = id;
      ptyRef.current = id;

      // Order matters. Subscribe first, then attach: the shell prints its
      // prompt the moment output starts flowing, and attaching before the
      // listener existed is what made the first prompt disappear.
      unlisten = await platform.pty.onData(id, (chunk) => xterm.write(chunk));
      xterm.onData((data) => {
        // The first keystroke after a prompt is the one moment the cursor is
        // known to be sitting exactly at the end of the prompt. Measured
        // here, once, and used from then on to tell the prompt apart from
        // what has been typed at it.
        if (promptCol.current === null) promptCol.current = xterm.buffer.active.cursorX;
        void platform.pty.write(id, data);
      });
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

    // Applied live, so changing it in Settings does not need a new tab. The
    // refit is what actually matters: a bigger glyph means fewer columns, and
    // a shell told the wrong size draws over its own output.
    function onFontChange(e: Event) {
      const next = (e as CustomEvent<TermFont>).detail;
      if (!next) return;
      xterm.options.fontSize = next.size;
      xterm.options.fontFamily = stackFor(next.family);
      try {
        fit.fit();
      } catch {
        return;
      }
      if (ptyId) void platform.pty.resize(ptyId, xterm.cols, xterm.rows);
    }
    window.addEventListener(TERM_FONT_EVENT, onFontChange);

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
      window.removeEventListener(TERM_FONT_EVENT, onFontChange);
      observer.disconnect();
      themeWatch.disconnect();
      // A decoration outlives the terminal that drew it unless it is told
      // otherwise, and one anchored to a disposed buffer is a leak that also
      // points at nothing.
      for (const mark of blockMarks.current) mark.dispose();
      blockMarks.current = [];
      clearTimeout(sweepDeadline);
      for (const mark of bannerMarks) mark.dispose();
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

      if (ptyId) void platform.pty.release(ptyId);
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
      claimKeys: (handler) => {
        keyClaim.current = handler;
      },
      type: (text) => {
        const id = ptyRef.current;
        if (id) void getPlatform().pty.write(id, text);
      },
      selection: () => term.current?.getSelection() ?? "",
      /*
       * The last few lines on screen, read out of xterm's own buffer.
       *
       * From the viewport's bottom upward, because what went wrong is the
       * last thing printed. Trailing blanks are dropped here rather than
       * shipped and trimmed later.
       */
      recentOutput: (lines = 40) => {
        const buffer = term.current?.buffer.active;
        if (!buffer) return "";

        const end = buffer.baseY + buffer.cursorY;
        const start = Math.max(0, end - lines);
        const out: string[] = [];
        for (let y = start; y <= end; y += 1) {
          out.push(buffer.getLine(y)?.translateToString(true) ?? "");
        }
        while (out.length > 0 && out[out.length - 1].trim() === "") out.pop();
        return out.join("\n");
      },
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
      clear: () => {
        term.current?.clear();
        // The marks go with the screen. A decoration anchored to a row that
        // was just scrolled away points at whatever is there now, which is
        // somebody else's command.
        for (const mark of blockMarks.current) mark.dispose();
        blockMarks.current = [];
        marks.current.reset();
      },
      focus: () => term.current?.focus(),
      blockOutput: (block) => {
        const xterm = term.current;
        const rows = outputRows(block);
        if (!xterm || !rows) return "";

        const buffer = xterm.buffer.active;
        const lines: string[] = [];
        for (let y = rows.from; y <= rows.to; y += 1) {
          // `true` trims the trailing whitespace a cell grid always has —
          // without it every line comes back padded to the terminal's width.
          lines.push(buffer.getLine(y)?.translateToString(true) ?? "");
        }
        return lines.join("\n").replace(/\s+$/, "");
      },

      scrollToLine: (line) => {
        const xterm = term.current;
        if (!xterm) return;
        // A little above it, so the command is not flush against the top edge
        // with its own output out of sight below.
        xterm.scrollToLine(Math.max(0, Math.floor(line) - 2));
      },

      promptInput: () => {
        const xterm = term.current;
        const start = promptCol.current;
        if (!xterm || start === null) return null;

        const buffer = xterm.buffer.active;
        const row = buffer.getLine(buffer.baseY + buffer.cursorY);
        if (!row) return null;

        // Only the cursor's own row. A command long enough to wrap is read
        // as its last line, which completes the word being typed correctly
        // and loses the earlier context — a smaller wrong answer than
        // stitching rows together and mistaking a hard newline for a soft
        // one.
        const text = row.translateToString(true);
        if (buffer.cursorX < start) return null;

        return { line: text.slice(start, buffer.cursorX), cursor: buffer.cursorX - start };
      },

      cwd: () => cwd.current,

      replaceRange: (from, to, text) => {
        const id = ptyRef.current;
        if (!id) return;
        // Backspaces and then text. There is no way to hand a shell a new
        // line except by typing it, and DEL is what a shell reads as one.
        const back = "\x7f".repeat(Math.max(0, to - from));
        void getPlatform().pty.write(id, back + text);
      },
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
