import { describe, expect, it } from "vitest";
import { JKY_GLYPH } from "../src/lib/glyph";
import { flattenPath, parseColor } from "../src/lib/geometry";

describe("flattenPath", () => {
  it("turns the chevron into its two strokes", () => {
    expect(flattenPath(JKY_GLYPH.chevron)).toEqual([
      [19, 22, 30, 32],
      [30, 32, 19, 42],
    ]);
  });

  it("follows the J's stem and then its hook to the same end point", () => {
    const segs = flattenPath(JKY_GLYPH.hook, 4);
    expect(segs[0]).toEqual([45, 20, 45, 38]);
    expect(segs).toHaveLength(1 + 4);
    const last = segs[segs.length - 1];
    expect(last[2]).toBeCloseTo(37);
    expect(last[3]).toBeCloseTo(46);
    // Each segment starts where the last one ended: one unbroken stroke.
    for (let i = 1; i < segs.length; i++) {
      expect(segs[i][0]).toBeCloseTo(segs[i - 1][2]);
      expect(segs[i][1]).toBeCloseTo(segs[i - 1][3]);
    }
  });

  it("keeps the curve inside its control triangle", () => {
    for (const [, , x, y] of flattenPath("M45 38 Q45 46 37 46", 8)) {
      expect(x).toBeGreaterThanOrEqual(37 - 1e-9);
      expect(x).toBeLessThanOrEqual(45 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(38 - 1e-9);
      expect(y).toBeLessThanOrEqual(46 + 1e-9);
    }
  });

  it("refuses commands it does not understand rather than drawing something else", () => {
    expect(() => flattenPath("M0 0 C1 1 2 2 3 3")).toThrow();
  });
});

describe("parseColor", () => {
  it("reads the forms theme tokens are written in", () => {
    expect(parseColor("#00e5ff")).toEqual([0, 229 / 255, 1]);
    expect(parseColor(" #fff ")).toEqual([1, 1, 1]);
    expect(parseColor("rgba(0, 229, 255, 0.14)")).toEqual([0, 229 / 255, 1]);
    expect(parseColor("rgb(255 0 0)")).toEqual([1, 0, 0]);
  });

  it("returns null instead of guessing", () => {
    expect(parseColor("var(--accent)")).toBeNull();
    expect(parseColor("")).toBeNull();
  });
});
