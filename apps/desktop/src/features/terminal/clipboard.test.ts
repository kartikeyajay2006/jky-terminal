import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText, readText } from "./clipboard";
import { clampToViewport } from "./TerminalMenu";

/** Swap in a clipboard, since jsdom does not provide a usable one. */
function withClipboard(impl: Partial<Clipboard>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: impl,
  });
}

describe("copying", () => {
  beforeEach(() => {
    document.execCommand = vi.fn(() => true);
  });
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("uses the clipboard API when it is there", async () => {
    const writeText = vi.fn(async () => {});
    withClipboard({ writeText });

    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back when the clipboard API is missing", async () => {
    // A webview without it is not a webview that should lose copy.
    withClipboard({});
    expect(await copyText("hello")).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back when the clipboard API refuses", async () => {
    withClipboard({
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    expect(await copyText("hello")).toBe(true);
    expect(document.execCommand).toHaveBeenCalled();
  });

  it("reports failure rather than throwing when everything refuses", async () => {
    // A terminal that throws an unhandled rejection because a copy was denied
    // is worse than one that quietly does nothing.
    withClipboard({});
    document.execCommand = vi.fn(() => {
      throw new Error("nope");
    });
    await expect(copyText("hello")).resolves.toBe(false);
  });

  it("does not bother with empty text", async () => {
    const writeText = vi.fn(async () => {});
    withClipboard({ writeText });
    expect(await copyText("")).toBe(false);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("leaves no scratch element behind", async () => {
    withClipboard({});
    await copyText("hello");
    expect(document.querySelectorAll("textarea")).toHaveLength(0);
  });
});

describe("reading", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
  });

  it("returns what is on the clipboard", async () => {
    withClipboard({ readText: vi.fn(async () => "pasted") });
    expect(await readText()).toBe("pasted");
  });

  it("returns null rather than throwing when reading is refused", async () => {
    withClipboard({
      readText: vi.fn(async () => {
        throw new Error("denied");
      }),
    });
    await expect(readText()).resolves.toBeNull();
  });

  it("returns null when there is no clipboard API at all", async () => {
    withClipboard({});
    expect(await readText()).toBeNull();
  });

  it("treats an empty clipboard as nothing to paste", async () => {
    withClipboard({ readText: vi.fn(async () => "") });
    expect(await readText()).toBeNull();
  });
});

describe("keeping the context menu on screen", () => {
  const size = { width: 200, height: 120 };
  const viewport = { width: 1000, height: 800 };

  it("leaves a click in open space where it was", () => {
    expect(clampToViewport({ x: 300, y: 300 }, size, viewport)).toEqual({
      x: 300,
      y: 300,
    });
  });

  it("pulls a menu back from the right edge", () => {
    // Otherwise the last item — usually the destructive one — is off screen.
    const { x } = clampToViewport({ x: 980, y: 300 }, size, viewport);
    expect(x + size.width).toBeLessThanOrEqual(viewport.width);
  });

  it("pulls a menu back from the bottom edge", () => {
    const { y } = clampToViewport({ x: 300, y: 780 }, size, viewport);
    expect(y + size.height).toBeLessThanOrEqual(viewport.height);
  });

  it("never pushes a menu off the top or left", () => {
    const { x, y } = clampToViewport({ x: -50, y: -50 }, size, viewport);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
  });

  it("prefers showing the top-left when the menu cannot fit at all", () => {
    const huge = { width: 2000, height: 2000 };
    const { x, y } = clampToViewport({ x: 500, y: 500 }, huge, viewport);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(y).toBeGreaterThanOrEqual(0);
  });
});
