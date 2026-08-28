import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: string[] = [];
const onDataHandlers: Array<(d: string) => void> = [];
const oscHandlers = new Map<number, (payload: string) => boolean>();
const disposed = { count: 0 };

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    open() {}
    write(data: string) {
      writes.push(data);
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
    getSelection() {
      return "";
    }
    clear() {}
    focus() {}
    loadAddon() {}
    // The real Terminal exposes a parser for escape-sequence handlers; the
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
    disposed.count = 0;
    __setPlatformForTests(createWebPlatform());
    useAsk.setState({ pending: null });
  });
  afterEach(() => __setPlatformForTests(null));

  it("renders a labelled terminal region", async () => {
    render(<Terminal tabId="tab-1" />);
    expect(await screen.findByRole("application", { name: /terminal/i })).toBeInTheDocument();
  });

  it("greets with the JKY wordmark before the shell speaks", async () => {
    render(<Terminal tabId="tab-1" />);
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

    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(order).toEqual(["onData", "attach"]));
  });

  it("writes pty output into the terminal", async () => {
    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("jky $"));
  });

  it("forwards keystrokes to the pty", async () => {
    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));

    writes.length = 0;
    onDataHandlers[0]("l");
    await waitFor(() => expect(writes.join("")).toContain("l"));
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

    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(resizes.length).toBeGreaterThan(0));
    expect(resizes[0][1]).toBeGreaterThan(0);
    expect(resizes[0][2]).toBeGreaterThan(0);
  });

  it("routes a jky ask escape sequence to the assistant", async () => {
    // The shell command emits OSC 1337 with a base64 question. The terminal
    // must consume it rather than printing it as stray characters.
    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));

    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode("what does ls do")));
    const consumed = oscHandlers.get(1337)!(`JKYAsk=${encoded}`);

    expect(consumed).toBe(true);
    expect(useAsk.getState().pending).toBe("what does ls do");
  });

  it("leaves another application's OSC 1337 payload alone", async () => {
    // OSC 1337 is shared. Consuming payloads that are not ours would break
    // whatever else is using it.
    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(oscHandlers.has(1337)).toBe(true));

    expect(oscHandlers.get(1337)!("CurrentDir=/home/x")).toBe(false);
    expect(useAsk.getState().pending).toBeNull();
  });

  it("disposes the terminal when the tab closes", async () => {
    const { unmount } = render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));
    unmount();
    await waitFor(() => expect(disposed.count).toBe(1));
  });
});
