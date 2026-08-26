import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writes: string[] = [];
const onDataHandlers: Array<(d: string) => void> = [];
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
    loadAddon() {}
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
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { createWebPlatform, __setPlatformForTests } from "../../platform";
import { Terminal } from "./Terminal";

describe("Terminal", () => {
  beforeEach(() => {
    writes.length = 0;
    onDataHandlers.length = 0;
    disposed.count = 0;
    __setPlatformForTests(createWebPlatform());
  });
  afterEach(() => __setPlatformForTests(null));

  it("renders a labelled terminal region", async () => {
    render(<Terminal tabId="tab-1" />);
    expect(await screen.findByRole("application", { name: /terminal/i })).toBeInTheDocument();
  });

  it("greets with the JKY wordmark before the shell speaks", async () => {
    render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(writes.join("")).toContain("JKY Terminal"));
    expect(writes.join("")).toContain("\u2588");
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

  it("disposes the terminal when the tab closes", async () => {
    const { unmount } = render(<Terminal tabId="tab-1" />);
    await waitFor(() => expect(onDataHandlers.length).toBeGreaterThan(0));
    unmount();
    await waitFor(() => expect(disposed.count).toBe(1));
  });
});
