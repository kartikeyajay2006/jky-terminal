import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The terminal has to survive being photographed.
 *
 * `WebglAddon` forwards its one constructor argument to `getContext` as
 * `preserveDrawingBuffer`. Left at its default, WebGL may throw a frame away
 * as soon as it has been drawn, so anything that reads the canvas afterwards
 * gets a blank buffer — and, worse, gets it without an error. A capture would
 * quietly produce a picture of the app with a hole where the terminal is.
 *
 * Measured on WebKitGTK 2.52.5 before the flag went in: a 756x1037 terminal
 * exported to 4KB of transparent PNG.
 *
 * jsdom has no WebGL, so no rendering test can catch a regression here. The
 * construction site is what gets pinned.
 */
const SOURCE = readFileSync(join(__dirname, "useXterm.ts"), "utf8");

describe("the terminal can be captured", () => {
  it("keeps the WebGL drawing buffer", () => {
    expect(SOURCE).toMatch(/new WebglAddon\(\s*true\s*\)/);
  });

  it("never constructs the addon with the discarding default", () => {
    // `new WebglAddon()` is the shape that silently breaks capture.
    expect(SOURCE).not.toMatch(/new WebglAddon\(\s*\)/);
  });
});
