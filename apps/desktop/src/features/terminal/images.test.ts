import { describe, expect, it, vi } from "vitest";

const made: Array<Record<string, unknown>> = [];
vi.mock("@xterm/addon-image", () => ({
  ImageAddon: class {
    constructor(options: Record<string, unknown>) {
      made.push(options);
    }
    dispose() {}
  },
}));

import { IMAGE_OPTIONS, loadImages } from "./images";

describe("inline images", () => {
  it("loads the image addon into the terminal", async () => {
    const loadAddon = vi.fn();
    await loadImages({ loadAddon });
    expect(loadAddon).toHaveBeenCalledTimes(1);
    expect(made.at(-1)).toMatchObject({ sixelSupport: true, iipSupport: true });
  });

  // Images arrive in terminal output, which is untrusted: a program, a remote
  // machine or a log can send one. Every limit is stated rather than left to
  // a default that may change under us.
  it("bounds what an image may cost", () => {
    expect(IMAGE_OPTIONS.pixelLimit).toBeLessThanOrEqual(4096 * 4096);
    expect(IMAGE_OPTIONS.storageLimit).toBeLessThanOrEqual(64);
    expect(IMAGE_OPTIONS.sixelSizeLimit).toBeLessThanOrEqual(25_000_000);
    expect(IMAGE_OPTIONS.iipSizeLimit).toBeLessThanOrEqual(20_000_000);
  });

  // Size reports answer a program asking the terminal its pixel size. They are
  // what lets an image tool size its output — and they reveal nothing beyond
  // the window's size — so they stay on, by decision rather than default.
  it("answers a program asking for the window's pixel size", () => {
    expect(IMAGE_OPTIONS.enableSizeReports).toBe(true);
  });

  it("never stops a terminal from opening when the addon cannot load", async () => {
    const loadAddon = vi.fn(() => {
      throw new Error("no canvas here");
    });
    await expect(loadImages({ loadAddon })).resolves.toBe(false);
  });
});
