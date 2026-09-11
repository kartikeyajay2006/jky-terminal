import { describe, expect, it } from "vitest";
import {
  ceiling,
  push,
  SPARK_HEIGHT,
  SPARK_SAMPLES,
  SPARK_WIDTH,
  sparkArea,
  sparkLine,
  sparkPoints,
} from "./spark";

describe("keeping a series", () => {
  it("adds to the end, so newest is last", () => {
    expect(push([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("never grows past the window", () => {
    let series: number[] = [];
    for (let i = 0; i < SPARK_SAMPLES * 2; i += 1) series = push(series, i);
    expect(series).toHaveLength(SPARK_SAMPLES);
    // And what it kept is the recent end.
    expect(series[series.length - 1]).toBe(SPARK_SAMPLES * 2 - 1);
  });

  it("takes a machine that answered with nonsense as zero", () => {
    // A reading that is not a number is a real thing; NaN in a path is not.
    expect(push([], Number.NaN)).toEqual([0]);
    expect(push([], Number.POSITIVE_INFINITY)).toEqual([0]);
  });
});

describe("choosing a ceiling", () => {
  it("uses the fixed one where there is one", () => {
    // Rescaling a percentage would make a quiet machine look as busy as a
    // loaded one.
    expect(ceiling([2, 4, 6], 100)).toBe(100);
  });

  it("uses the tallest reading where there is no ceiling", () => {
    expect(ceiling([10, 40, 25])).toBe(40);
  });

  it("never divides by zero on a completely idle series", () => {
    expect(ceiling([0, 0, 0])).toBe(1);
    expect(ceiling([])).toBe(1);
  });
});

describe("drawing the line", () => {
  it("has nothing to draw with no readings", () => {
    expect(sparkPoints([], 100)).toEqual([]);
    expect(sparkArea([])).toBe("");
  });

  it("draws one reading as a flat line at its own height", () => {
    // Which is true, and reads as steady rather than as absent.
    const points = sparkPoints([50], 100);
    expect(points).toEqual([
      [0, SPARK_HEIGHT / 2],
      [SPARK_WIDTH, SPARK_HEIGHT / 2],
    ]);
  });

  it("puts the newest reading on the right", () => {
    const points = sparkPoints([0, 100], 100);
    expect(points[0]).toEqual([0, SPARK_HEIGHT]);
    expect(points[1]).toEqual([SPARK_WIDTH, 0]);
  });

  it("spreads a short series across the whole width", () => {
    // A line that grew in from one side would spend its first minute looking
    // broken.
    const points = sparkPoints([1, 2, 3], 3);
    expect(points[0][0]).toBe(0);
    expect(points[points.length - 1][0]).toBe(SPARK_WIDTH);
  });

  it("keeps every point inside the box, whatever the reading says", () => {
    const points = sparkPoints([-50, 0, 500, Number.NaN], 100);
    for (const [x, y] of points) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(SPARK_HEIGHT);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(SPARK_WIDTH);
    }
  });

  it("draws a flat line for a series that never changes", () => {
    const points = sparkPoints([30, 30, 30], 100);
    const heights = new Set(points.map(([, y]) => y));
    expect(heights.size).toBe(1);
  });

  it("writes points a polyline can read", () => {
    expect(sparkLine([[0, 24], [100, 0]])).toBe("0,24 100,0");
  });

  it("closes the area to the floor at both ends, so it can be filled", () => {
    const path = sparkArea([[0, 12], [100, 6]]);
    expect(path.startsWith(`M0,${SPARK_HEIGHT}`)).toBe(true);
    expect(path.endsWith(`L100,${SPARK_HEIGHT} Z`)).toBe(true);
  });

  it("never puts a NaN in a path, whatever it was given", () => {
    const path = sparkArea(sparkPoints([Number.NaN, Number.NaN], 0));
    expect(path).not.toContain("NaN");
  });
});
