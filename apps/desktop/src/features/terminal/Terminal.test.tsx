import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeDone } from "./commandFailure";
import { offsetToWordmark } from "./banner";

const writes: string[] = [];
const onDataHandlers: Array<(d: string) => void> = [];
const oscHandlers = new Map<number, (payload: string) => boolean>();
const customKeyHandlers: Array<(e: KeyboardEvent) => boolean> = [];
interface FakeDecoration {
  height?: number;
  marker?: unknown;
  options?: Record<string, unknown>;
  element: HTMLElement;
  disposed: boolean;
}
const markers: Array<{ disposed: boolean }> = [];
const decorations: FakeDecoration[] = [];
const disposed = { count: 0 };
// What xterm calls once a write has been parsed. Held until a test says so,
// so a test that does not care what happens after a write is unaffected.
const writeCallbacks: Array<() => void> = [];
const flushWrites = () => {
  while (writeCallbacks.length) writeCallbacks.shift()!();
};
const created: Array<{ options: Record<string, unknown> }> = [];

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown> = {}) {
      this.options = { ...options };
      created.push(this);
    }
    open() {}
    write(data: string, done?: () => void) {
      writes.push(data);
      if (done) writeCallbacks.push(done);
    }
    onData(cb: (d: string) => void) {
      onDataHandlers.push(cb);
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
    // Copy-on-select subscribes to this.
    onSelectionChange() {
      return { dispose() {} };
    }
    /*
     * Enough of a buffer to read a command's output from.
     *
     * The real one is what the panel reads to find out what a command
     * printed; here it is empty, which is the honest answer for a mock that
     * draws nothing — a recogniser handed no output declines, and the tests
     * that care about parsing use captured sessions instead.
     */
    buffer = {
      active: {
        baseY: 0,
        cursorY: 0,
        getLine: () => ({ translateToString: () => "" }),
      },
    };
    getSelection() {
      return "";
    }
    clear() {}
    focus() {}
    attachCustomKeyEventHandler(cb: (e: KeyboardEvent) => boolean) {
      customKeyHandlers.push(cb);
    }
    loadAddon() {}
    // The real Terminal exposes a parser for escape-sequence handlers; the
    /*
     * Markers and decorations, which is how a block's gutter mark is drawn.
     *
     * Enough of them to be driven: each decoration keeps the element it was
     * rendered into, so a test can click it the way a person would.
     */
    registerMarker(offset: number) {
      const marker = { line: 0, offset, disposed: false, dispose() { this.disposed = true; } };
      markers.push(marker);
      return marker;
    }
    registerDecoration(options: { marker: unknown; height?: number }) {
      const element = document.createElement("div");
      const decoration = {
        marker: options.marker,
        height: options.height,
        options,
        element,
        disposed: false,
        onRender(cb: (el: HTMLElement) => void) {
          cb(element);
          return { dispose() {} };
        },
        dispose() {
          this.disposed = true;
        },
      };
      decorations.push(decoration);
      return decoration;
    }
    // app registers an OSC handler for `jky ask`.
    parser = {
      registerOscHandler(code: number, cb: (payload: string) => boolean) {
        oscHandlers.set(code, cb);
        return { dispose() {} };
      },
    };
    dispose() {
      disposed.count += 1;
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    activate() {}
    fit() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    activate() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    activate() {}
    dispose() {}
    onDidChangeResults() {
      return { dispose() {} };
    }
    findNext() {
      return false;
    }
    findPrevious() {
      return false;
    }
    clearDecorations() {}
  },
}));
vi.mock("@xterm/addon-serialize", () => ({
  SerializeAddon: class {
    activate() {}
    dispose() {}
    serialize() {
      return "PREVIOUS-OUTPUT";
    }
  },
}));
vi.mock("@xterm/addon-web-links", () => ({
  WebLinksAddon: class {
    activate() {}
    dispose() {}
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { useAsk } from "../../app/askStore";
import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Terminal } from "./Terminal";

describe("Terminal", () => {
  beforeEach(() => {
    writes.length = 0;
    onDataHandlers.length = 0;
    oscHandlers.clear();
    markers.length = 0;
    decorations.length = 0;
    created.length = 0;
    writeCallbacks.length = 0;
    disposed.count = 0;
    __setPlatformForTests(createWebPlatform());
    useAsk.setState({ pending: null });
  });
  afterEach(() => __setPlatformForTests(null));

  it("renders a labelled terminal region", async () => {
    render(<Terminal paneId="tab-1" />);
    expect(await screen.findByRole("application", { name: /terminal/i })).toBeInTheDocument();
  });

  it("greets with the JKY wordmark before the shell speaks", async () => {
    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("Infinite Possibilities."));
    expect(writes.join("")).toContain("\u2588");
  });

  it("subscribes before attaching, so the shell's first prompt is not lost", async () => {
    // This race has cost the first prompt twice. Pin the order: the listener
    // must exist before output starts flowing.
    const order: string[] = [];
    const platform = createWebPlatform();
    const realOnData = platform.pty.onData.bind(platform.pty);
    const realAttach = platform.pty.attach.bind(platform.pty);
    __setPlatformForTests({
      ...platform,
      pty: {
        ...platform.pty,
        onData: (id, h) => {
          order.push("onData");
          return realOnData(id, h);
        },
        attach: (id) => {
          order.push("attach");
          return realAttach(id);
        },
      },
    });

    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(order).toEqual(["onData", "attach"]));
  });

  it("writes pty output into the terminal", async () => {
    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
  });

  it("names its pane when it asks for a shell, so the shell can be found again", async () => {
    const panes: Array<string | null | undefined> = [];
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      pty: {
        ...platform.pty,
        spawn: (cols, rows, banner, accent, cwd, pane) => {
          panes.push(pane);
          return platform.pty.spawn(cols, rows, banner, accent, cwd, pane);
        },
      },
    });

    render(<Terminal paneId="pane-7" />);
    await waitFor(() => expect(panes).toEqual(["pane-7"]));
  });

  it("draws neither old scrollback nor the banner over a shell it rejoined", async () => {
    // A rejoined shell sends what it printed while nobody watched. Old
    // scrollback above that would show the same session twice, and a banner
    // would greet a shell that has been running for an hour.
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      scrollback: { ...platform.scrollback, load: async () => "OLD-SESSION-TEXT" },
      pty: {
        ...platform.pty,
        spawn: async () => ({ id: "held-1", reattached: true, survives: true }),
      },
    });

    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
    expect(writes.join("")).not.toContain("OLD-SESSION-TEXT");
    expect(writes.join("")).not.toContain("Infinite Possibilities.");
  });

  it("restores old scrollback above a shell that is new", async () => {
    // What already happens, kept true through the reordering: a new shell
    // still gets its history and its greeting.
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      scrollback: { ...platform.scrollback, load: async () => "OLD-SESSION-TEXT" },
    });

    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
    expect(writes.join("")).toContain("OLD-SESSION-TEXT");
    expect(writes.join("")).toContain("Infinite Possibilities.");
  });

  it("forwards keystrokes to the pty", async () => {
    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));

    writes.length = 0;
    onDataHandlers[0]("l");
    await waitFor(() => expect(writes.join("")).toContain("l"));
  });

  it("takes its colours from the theme, and follows a change of theme", async () => {
    // A terminal that kept xterm's own black would be a black box in every
    // light theme — the one part of the window that ignored the choice.
    const root = document.documentElement;
    root.style.setProperty("--ground", "#101820");
    root.style.setProperty("--text", "#dde6f0");
    try {
      render(<Terminal paneId="tab-1" />);
      await waitFor(() => expect(created.length).toBeGreaterThan(0));
      const theme = () => created[0].options.theme as Record<string, string> | undefined;
      expect(theme()?.background).toBe("#101820");
      expect(theme()?.foreground).toBe("#dde6f0");

      root.style.setProperty("--ground", "#fbf7ef");
      root.style.setProperty("--text", "#2e2617");
      root.setAttribute("data-theme", "gold");
      await waitFor(() => expect(theme()?.background).toBe("#fbf7ef"));
      expect(theme()?.foreground).toBe("#2e2617");
    } finally {
      root.style.removeProperty("--ground");
      root.style.removeProperty("--text");
      root.removeAttribute("data-theme");
    }
  });

  it("pins the emblem beside a new terminal's wordmark, and takes it down with the terminal", async () => {
    const { unmount } = render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.some((w) => w.includes("Infinite Possibilities."))).toBe(true));
    flushWrites();

    const emblem = decorations.find((d) => d.element.classList.contains("term__emblem"));
    expect(emblem, "no emblem beside the wordmark").toBeDefined();
    expect(emblem!.element.querySelector("svg.emblem")).not.toBeNull();

    // On the wordmark's own line: back from where the banner left the cursor.
    const banner = writes.find((w) => w.includes("Infinite Possibilities."))!;
    expect((emblem!.marker as { offset: number }).offset).toBe(offsetToWordmark(banner));

    unmount();
    expect(emblem!.disposed, "the emblem outlived its terminal").toBe(true);
  });

  it("sweeps light down the wordmark once, then takes the light away", async () => {
    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.some((w) => w.includes("Infinite Possibilities."))).toBe(true));
    flushWrites();

    const sweep = decorations.find((d) => d.element.classList.contains("term__sweep"));
    expect(sweep, "no light across the wordmark").toBeDefined();
    expect(sweep!.disposed).toBe(false);

    sweep!.element.dispatchEvent(new Event("animationend"));
    expect(sweep!.disposed, "the light stayed over the letters").toBe(true);
  });

  it("pins nothing over a shell it rejoined, which has no banner to sit beside", async () => {
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      pty: {
        ...platform.pty,
        spawn: async () => ({ id: "held-1", reattached: true, survives: true }),
      },
    });

    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
    flushWrites();

    expect(decorations.filter((d) => d.element.classList.contains("term__emblem"))).toEqual([]);
  });

  it("tells the pty its real size once spawn completes", async () => {
    // The ResizeObserver fires while spawn is still in flight, so its resize
    // is skipped. Without an explicit push afterwards the shell keeps the
    // size guessed before layout settled, and anything drawing on the bottom
    // row gets clipped.
    const resizes: Array<[string, number, number]> = [];
    const platform = createWebPlatform();
    __setPlatformForTests({
      ...platform,
      pty: {
        ...platform.pty,
        resize: async (id, cols, rows) => {
          resizes.push([id, cols, rows]);
        },
      },
    });

    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(resizes.length).toBeGreaterThan(0));
    expect(resizes[0][1]).toBeGreaterThan(0);
    expect(resizes[0][2]).toBeGreaterThan(0);
  });

  it("routes a jky ask escape sequence to the assistant", async () => {
    // The shell command emits OSC 1337 with a base64 question. The terminal
    // must consume it rather than printing it as stray characters.
    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));

    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode("what does ls do")));
    const consumed = oscHandlers.get(1337)!(`JKYAsk=${encoded}`);

    expect(consumed).toBe(true);
    expect(useAsk.getState().pending).toBe("what does ls do");
  });

  it("leaves another application's OSC 1337 payload alone", async () => {
    // OSC 1337 is shared. Consuming payloads that are not ours would break
    // whatever else is using it.
    render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));

    expect(oscHandlers.get(1337)!("CurrentDir=/home/x")).toBe(false);
    expect(useAsk.getState().pending).toBeNull();
  });

  it("disposes the terminal when the tab closes", async () => {
    const { unmount } = render(<Terminal paneId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));
    unmount();
    await waitFor(() => expect(disposed.count).toBe(1));
  });
});

describe("scrollback across a restart", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    writes.length = 0;
  });
  afterEach(() => __setPlatformForTests(null));

  it("replays what the tab had last time, before this session's banner", async () => {
    const platform = createWebPlatform();
    await platform.scrollback.save("tab-7", "OLD SESSION OUTPUT");
    __setPlatformForTests(platform);

    render(<Terminal paneId="tab-7" />);

    await waitFor(() => {
      expect(writes.join("")).toContain("OLD SESSION OUTPUT");
    });
    // The history comes first, so the scrollback reads as a history rather
    // than as a terminal that mysteriously already has text in it.
    const all = writes.join("");
    expect(all.indexOf("OLD SESSION OUTPUT")).toBeLessThan(all.indexOf("Infinite"));
  });

  it("starts clean when the tab has no history", async () => {
    render(<Terminal paneId="tab-fresh" />);
    await waitFor(() => expect(writes.join("")).toContain("Infinite"));
    expect(writes.join("")).not.toContain("OLD SESSION");
  });

  it("saves what was on screen when the tab goes away", async () => {
    const platform = createWebPlatform();
    __setPlatformForTests(platform);

    const { unmount } = render(<Terminal paneId="tab-8" />);
    await waitFor(() => expect(writes.join("")).toContain("Infinite"));
    unmount();

    await waitFor(async () => {
      expect(await platform.scrollback.load("tab-8")).toContain("PREVIOUS-OUTPUT");
    });
  });

  it("still opens when the saved history cannot be read", async () => {
    // A terminal that will not open because its history could not be read
    // would be a poor trade for a convenience.
    const base = createWebPlatform();
    __setPlatformForTests({
      ...base,
      scrollback: {
        ...base.scrollback,
        load: async () => {
          throw new Error("unreadable");
        },
      },
    });

    render(<Terminal paneId="tab-9" />);
    await waitFor(() => expect(writes.join("")).toContain("Infinite"));
  });
});

describe("letting the app's shortcuts through", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
    customKeyHandlers.length = 0;
  });
  afterEach(() => __setPlatformForTests(null));

  function handler() {
    render(<Terminal paneId="tab-keys" />);
    expect(customKeyHandlers.length).toBeGreaterThan(0);
    return customKeyHandlers[customKeyHandlers.length - 1];
  }

  /*
   * A panel's number keys have to be taken before the shell sees them.
   *
   * xterm handles a key by calling stopPropagation — the comment on the test
   * below says so, and it is why the offer under a failed command could only
   * be answered with the mouse. The window listener never fired, because the
   * event never reached the window. Pressing 1 typed a 1 at the prompt.
   *
   * So the panel claims its keys through xterm's own handler, which is the
   * only place they can be intercepted before the shell is sent them.
   */
  it("takes a panel's keys before the shell sees them", async () => {
    // With no provider there is nothing for 1 to 3 to do, and a digit that
    // does nothing belongs to the shell — so the offer has to be a real one
    // before it can claim them.
    const base = createWebPlatform();
    __setPlatformForTests({
      ...base,
      vault: {
        ...base.vault,
        async listProviders() {
          return [
            {
              id: "anthropic",
              displayName: "Anthropic",
              tagline: "",
              consoleUrl: "",
              requiresKey: true,
              keyPrefixes: [],
              connected: true,
              models: [],
              defaultModel: "",
              selectedModel: null,
            },
          ];
        },
      },
    });

    render(<Terminal paneId="tab-claim" />);
    const handle = customKeyHandlers[customKeyHandlers.length - 1];

    // Nothing open: a digit is just a digit and belongs to the shell.
    expect(handle(new KeyboardEvent("keydown", { key: "1" }))).toBe(true);

    // A command failed, so the offer appears and claims 1 to 4.
    const report = encodeDone(127, "/repo", "gti status");
    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));
    oscHandlers.get(1337)!(report);

    // Waits for the offer to have something to offer: the provider list is
    // fetched, so the buttons appear a tick after the panel does.
    await screen.findByRole("button", { name: /explain/i });
    for (const key of ["1", "2", "3", "4"]) {
      expect(
        handle(new KeyboardEvent("keydown", { key })),
        `${key} reached the shell`,
      ).toBe(false);
    }
    // Everything else still belongs to the shell.
    expect(handle(new KeyboardEvent("keydown", { key: "5" }))).toBe(true);
    expect(handle(new KeyboardEvent("keydown", { key: "l" }))).toBe(true);
  });

  /*
   * A claimed key must not also do whatever the browser would have done.
   *
   * Returning false stops xterm handling a key, but xterm only calls
   * preventDefault for keys it handles — so the browser went on to run its
   * own default. For Tab that is moving focus to the next control, which is
   * the theme picker in the status bar: you pressed Tab to complete a word
   * and had to click back into the terminal to keep typing.
   */
  it("stops the browser acting on a key a panel has taken", async () => {
    render(<Terminal paneId="tab-claim-default" />);
    const handle = customKeyHandlers[customKeyHandlers.length - 1];

    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));
    oscHandlers.get(1337)!(encodeDone(127, "/repo", "gti status"));
    await screen.findByRole("group", { name: /command failed/i });

    const claimed = new KeyboardEvent("keydown", { key: "4", cancelable: true });
    expect(handle(claimed)).toBe(false);
    expect(claimed.defaultPrevented, "the browser still acted on a claimed key").toBe(true);
  });

  it("leaves the browser alone for a key no panel wants", async () => {
    render(<Terminal paneId="tab-claim-default-2" />);
    const handle = customKeyHandlers[customKeyHandlers.length - 1];

    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));
    oscHandlers.get(1337)!(encodeDone(127, "/repo", "gti status"));
    await screen.findByRole("group", { name: /command failed/i });

    // Unclaimed keys go to the shell, and preventing their default here
    // would be this handler deciding things that are not its business.
    const free = new KeyboardEvent("keydown", { key: "l", cancelable: true });
    expect(handle(free)).toBe(true);
    expect(free.defaultPrevented).toBe(false);
  });

  // Claimed only while it is open: dismissing gives the digits back.
  it("gives the keys back when the panel goes", async () => {
    render(<Terminal paneId="tab-claim-2" />);
    const handle = customKeyHandlers[customKeyHandlers.length - 1];

    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));
    oscHandlers.get(1337)!(encodeDone(127, "/repo", "gti status"));
    await screen.findByRole("group", { name: /command failed/i });
    expect(handle(new KeyboardEvent("keydown", { key: "4" }))).toBe(false);

    await waitFor(() =>
      expect(screen.queryByRole("group", { name: /command failed/i })).not.toBeInTheDocument(),
    );
    expect(handle(new KeyboardEvent("keydown", { key: "1" }))).toBe(true);
  });

  /*
   * Shift+Enter, which a terminal has had no way to say since 1978.
   *
   * An assistant reading a paragraph needs a key for "newline" that is not
   * "send". Without one a multi-line prompt submits itself halfway through,
   * which in a terminal that calls itself an AI terminal is the feature not
   * working rather than a rough edge.
   */
  it("sends a newline for Shift+Enter, and does not let xterm send Enter too", async () => {
    render(<Terminal paneId="tab-shift-enter" />);
    const handle = customKeyHandlers[customKeyHandlers.length - 1];
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    writes.length = 0;

    const event = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true });
    // False keeps xterm out of it, so the carriage return that would have run
    // the command is never sent.
    expect(handle(event)).toBe(false);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(writes.join("")).toBe("\n"));
  });

  it("leaves plain Enter to the shell", async () => {
    render(<Terminal paneId="tab-plain-enter" />);
    const handle = customKeyHandlers[customKeyHandlers.length - 1];
    await waitFor(() => expect(writes.length).toBeGreaterThan(0));
    writes.length = 0;

    const event = new KeyboardEvent("keydown", { key: "Enter", cancelable: true });
    // Enter still runs the command, or this would be a terminal you cannot
    // use a shell in.
    expect(handle(event)).toBe(true);
    expect(event.defaultPrevented).toBe(false);
    expect(writes.join("")).toBe("");
  });

  it("hands the app's shortcuts back rather than swallowing them", () => {
    // The bug this fixes: xterm handles a key by calling stopPropagation, so
    // Ctrl+T pressed in a terminal never reached the window listener and every
    // app shortcut was dead in the one place people spend most of their time.
    const handle = handler();
    for (const key of ["k", "t", "w", "f"]) {
      const e = new KeyboardEvent("keydown", { key, ctrlKey: true });
      expect(handle(e), `Ctrl+${key}`).toBe(false);
    }
  });

  it("hands back the tab numbers too", () => {
    const handle = handler();
    const e = new KeyboardEvent("keydown", { key: "3", ctrlKey: true });
    expect(handle(e)).toBe(false);
  });

  it("keeps every ordinary keystroke for the shell", () => {
    const handle = handler();
    for (const key of ["a", "Enter", "ArrowUp", " "]) {
      const e = new KeyboardEvent("keydown", { key });
      expect(handle(e), key).toBe(true);
    }
  });

  it("keeps the shell's own control keys", () => {
    // Ctrl+C must interrupt, not be eaten by the app.
    const handle = handler();
    for (const key of ["c", "d", "z", "l", "r"]) {
      const e = new KeyboardEvent("keydown", { key, ctrlKey: true });
      expect(handle(e), `Ctrl+${key}`).toBe(true);
    }
  });

  it("leaves keyup alone, so only the press is intercepted", () => {
    const handle = handler();
    const e = new KeyboardEvent("keyup", { key: "t", ctrlKey: true });
    expect(handle(e)).toBe(true);
  });

  /*
   * A command becomes something you can point at.
   *
   * The terminal already knew where every command started and ended — that is
   * what the shell marks are for — but nothing on screen said so, and copying
   * one command's output meant dragging a mouse and hoping the edges landed
   * right. These check that the mark is drawn and that clicking it offers the
   * things worth doing with that command.
   */
  describe("blocks", () => {
    const finish = async (code: number, command: string) => {
      await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));
      // The 133 marks bound the block; the 1337 report names it.
      // The real order a shell sends these in: prompt, output, status —
      // and only then the report that says what was typed.
      oscHandlers.get(133)?.("A");
      oscHandlers.get(133)?.("C");
      oscHandlers.get(133)?.(`D;${code}`);
      oscHandlers.get(1337)!(encodeDone(code, "/repo", command));
    };

    it("marks a command in the gutter once it has finished", async () => {
      render(<Terminal paneId="tab-blocks" />);
      expect(decorations, "a mark before anything ran").toHaveLength(0);

      await finish(0, "cargo test");
      await waitFor(() => expect(decorations.length).toBeGreaterThan(0));
      expect(decorations.at(-1)!.element.dataset.tone).toBe("ok");
    });

    it("marks a failure apart from a success", async () => {
      render(<Terminal paneId="tab-blocks-2" />);
      await finish(127, "gti status");
      await waitFor(() => expect(decorations.length).toBeGreaterThan(0));
      expect(decorations.at(-1)!.element.dataset.tone).toBe("failed");
    });

    it("offers what can be done with that one command", async () => {
      render(<Terminal paneId="tab-blocks-3" />);
      await finish(0, "cargo test");
      await waitFor(() => expect(decorations.length).toBeGreaterThan(0));

      decorations.at(-1)!.element.click();

      const menu = await screen.findByRole("menu");
      for (const label of [/copy output/i, /copy command/i, /run it again/i]) {
        expect(within(menu).getByRole("menuitem", { name: label })).toBeInTheDocument();
      }
    });

    it("asks why a failure failed rather than what it means", async () => {
      render(<Terminal paneId="tab-blocks-4" />);
      await finish(1, "git push");
      await waitFor(() => expect(decorations.length).toBeGreaterThan(0));

      decorations.at(-1)!.element.click();
      const menu = await screen.findByRole("menu");
      expect(within(menu).getByRole("menuitem", { name: /ask why it failed/i })).toBeInTheDocument();
    });

    it("types a re-run rather than running it", async () => {
      render(<Terminal paneId="tab-blocks-5" />);
      await finish(0, "cargo test");
      await waitFor(() => expect(decorations.length).toBeGreaterThan(0));
      writes.length = 0;

      decorations.at(-1)!.element.click();
      const menu = await screen.findByRole("menu");
      await userEvent.click(within(menu).getByRole("menuitem", { name: /run it again/i }));

      // Typed, never run. No newline, so the person still presses Enter and
      // sees exactly what is about to happen.
      await waitFor(() => expect(writes.join("")).toContain("cargo test"));
      expect(writes.join("")).not.toContain("\n");
    });

    it("keeps no more marks than there are commands to remember", async () => {
      render(<Terminal paneId="tab-blocks-cap" />);
      await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));

      // Well past the limit. Unbounded, this left a decoration and a marker
      // for every command a terminal had ever run.
      for (let i = 0; i < 520; i += 1) {
        oscHandlers.get(133)?.("A");
        oscHandlers.get(133)?.("C");
        oscHandlers.get(133)?.("D;0");
        oscHandlers.get(1337)!(encodeDone(0, "/repo", `echo ${i}`));
      }

      await waitFor(() => expect(decorations.length).toBeGreaterThan(500));
      const alive = decorations.filter((d) => !d.disposed);
      expect(alive.length, "marks grew without bound").toBeLessThanOrEqual(500);
      // The oldest went first, so what is kept is what is on screen.
      expect(decorations[0].disposed).toBe(true);
      expect(decorations.at(-1)!.disposed).toBe(false);
    });

    it("takes its marks with it when the screen is cleared", async () => {
      render(<Terminal paneId="tab-blocks-6" />);
      await finish(0, "ls");
      await waitFor(() => expect(decorations.length).toBeGreaterThan(0));
      const drawn = decorations.at(-1)!;

      // Through the menu item that does it, which is the only way the app
      // clears — Ctrl+L belongs to the shell and never reaches this.
      const term = screen.getByRole("application", { name: /terminal/i });
      fireEvent.contextMenu(term, { clientX: 20, clientY: 20 });
      await userEvent.click(
        within(await screen.findByRole("menu")).getByRole("menuitem", { name: /^clear$/i }),
      );
      // A decoration anchored to a row that has been scrolled away points at
      // whatever is there now, which is somebody else's command.
      await waitFor(() => expect(drawn.disposed).toBe(true));
    });
  });
});
