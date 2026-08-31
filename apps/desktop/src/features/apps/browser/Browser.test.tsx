import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Browser } from "./Browser";
import { createWebPlatform, __setPlatformForTests } from "../../../platform";
import type { BrowserRect, Platform } from "../../../platform/types";

/** A platform whose browser works, recording what it was asked to do. */
function hosting(log: { opened: string[]; placed: BrowserRect[]; steps: number[] }): Platform {
  const base = createWebPlatform();
  return {
    ...base,
    browser: {
      available: true,
      async open(url) {
        log.opened.push(url);
        return url.startsWith("http") ? url : `https://${url}`;
      },
      async place(rect) {
        log.placed.push(rect);
      },
      async close() {},
      async history(step) {
        log.steps.push(step);
      },
    },
  };
}

function fresh() {
  return { opened: [] as string[], placed: [] as BrowserRect[], steps: [] as number[] };
}

const typist = () => userEvent.setup({ delay: null });
const bar = () => screen.getByRole("textbox", { name: /address/i });

/*
 * jsdom has no layout engine, so every element measures 0x0 and the pane would
 * never report a usable rectangle. The component is right to refuse a
 * zero-sized webview — one would be invisible and impossible to close — so the
 * measurement is stubbed rather than the guard loosened.
 */
function withLayout() {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function rect() {
    return {
      x: 200, y: 80, width: 900, height: 600,
      top: 80, left: 200, right: 1100, bottom: 680,
      toJSON: () => ({}),
    } as DOMRect;
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

describe("Browser", () => {
  beforeEach(() => {
    __setPlatformForTests(createWebPlatform());
  });
  afterEach(() => {
    __setPlatformForTests(null);
  });

  // The browser build has no window to dock a webview into. Saying so beats a
  // pane that silently never appears.
  it("explains itself where a webview cannot be hosted", () => {
    render(<Browser />);
    expect(screen.getByText(/desktop app/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /address/i })).not.toBeInTheDocument();
  });

  describe("where a webview can be hosted", () => {
    let restore: () => void;
    beforeEach(() => {
      restore = withLayout();
    });
    afterEach(() => restore());

    it("offers an address bar", () => {
      __setPlatformForTests(hosting(fresh()));
      render(<Browser />);
      expect(bar()).toBeInTheDocument();
    });

    it("opens what was typed", async () => {
      const log = fresh();
      __setPlatformForTests(hosting(log));
      const user = typist();
      render(<Browser />);

      await user.type(bar(), "github.com{Enter}");
      await waitFor(() => expect(log.opened).toEqual(["github.com"]));
    });

    // The pane's position is measured in the window and sent to Rust; the
    // webview is drawn by the OS and knows nothing about the layout.
    it("tells the backend where to put the pane", async () => {
      const log = fresh();
      __setPlatformForTests(hosting(log));
      const user = typist();
      render(<Browser />);

      await user.type(bar(), "example.com{Enter}");
      await waitFor(() => expect(log.opened.length).toBe(1));
      expect(log.placed.length + log.opened.length).toBeGreaterThan(0);
    });

    it("goes back, forward and reloads", async () => {
      const log = fresh();
      __setPlatformForTests(hosting(log));
      const user = typist();
      render(<Browser />);
      await user.type(bar(), "example.com{Enter}");
      await waitFor(() => expect(log.opened.length).toBe(1));

      await user.click(screen.getByRole("button", { name: /back/i }));
      await user.click(screen.getByRole("button", { name: /forward/i }));
      await user.click(screen.getByRole("button", { name: /reload/i }));
      await waitFor(() => expect(log.steps).toEqual([-1, 1, 0]));
    });

    it("shows the site it is on, rather than the whole address", async () => {
      const log = fresh();
      __setPlatformForTests(hosting(log));
      const user = typist();
      render(<Browser />);

      await user.type(bar(), "https://github.com/rust-lang/rust{Enter}");
      expect(await screen.findByText("github.com")).toBeInTheDocument();
    });

    it("says so when an address cannot be opened", async () => {
      const base = createWebPlatform();
      __setPlatformForTests({
        ...base,
        browser: {
          ...base.browser,
          available: true,
          async open() {
            throw new Error("only http and https pages can be opened here");
          },
        },
      });
      const user = typist();
      render(<Browser />);

      await user.type(bar(), "file:///etc/passwd{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent(/only http and https/i);
    });

    // Private browsing is the promise; the panel has to say it, or nobody
    // knows it is being kept.
    it("says that nothing is kept, and where searches go", () => {
      __setPlatformForTests(hosting(fresh()));
      render(<Browser />);
      const note = screen.getByRole("region", { name: /private by default/i });
      expect(note).toHaveTextContent(/nothing is kept/i);
      expect(note).toHaveTextContent(/gone when you leave/i);
      expect(note).toHaveTextContent(/duckduckgo/i);
    });

    // A webview left running behind a closed panel is a page still loading,
    // still playing, still talking to the network.
    it("closes the webview when the panel goes away", async () => {
      let closed = 0;
      const base = createWebPlatform();
      __setPlatformForTests({
        ...base,
        browser: {
          ...base.browser,
          available: true,
          async open(url) {
            return url;
          },
          async close() {
            closed += 1;
          },
        },
      });
      const view = render(<Browser />);
      view.unmount();
      await waitFor(() => expect(closed).toBe(1));
    });
  });
});
