/**
 * Turning a run of readings into a line.
 *
 * Kept apart from the drawing because the awkward parts are arithmetic: one
 * sample, no samples, every sample identical, a machine that answered with
 * nonsense. A flat line and a crash are one `/ 0` apart, and none of it needs
 * a DOM to be proven.
 */

/** The box a sparkline is drawn in. Stretched by CSS, so the numbers are a ratio. */
export const SPARK_WIDTH = 100;
export const SPARK_HEIGHT = 24;

/**
 * How many readings a line remembers.
 *
 * At one reading every two seconds this is about eighty seconds — long enough
 * to show a spike you just caused, short enough that the line still moves
 * visibly rather than creeping.
 */
export const SPARK_SAMPLES = 40;

/** Keep the last `SPARK_SAMPLES` of a series, oldest first. */
export function push(series: number[], value: number): number[] {
  const kept = [...series, Number.isFinite(value) ? value : 0];
  return kept.length > SPARK_SAMPLES ? kept.slice(kept.length - SPARK_SAMPLES) : kept;
}

/**
 * The tallest value a line should be drawn against.
 *
 * A fixed ceiling where one exists — a percentage is always out of a hundred,
 * and rescaling it would make a quiet machine look as busy as a loaded one.
 * Where there is no ceiling, the tallest reading so far, with a floor so a
 * completely idle series does not magnify its own noise into a mountain.
 */
export function ceiling(series: number[], fixed?: number): number {
  if (fixed !== undefined) return fixed;
  const tallest = series.reduce((high, v) => (Number.isFinite(v) && v > high ? v : high), 0);
  return tallest > 0 ? tallest : 1;
}

/**
 * The points of the line, in the order they are drawn.
 *
 * Newest on the right, which is the direction time runs everywhere else.
 * Fewer samples than the window holds are drawn across the whole width rather
 * than squeezed into the left of it: a line that grew in from one side would
 * spend its first minute looking broken.
 */
export function sparkPoints(
  series: number[],
  max: number,
  width = SPARK_WIDTH,
  height = SPARK_HEIGHT,
): Array<[number, number]> {
  if (series.length === 0) return [];

  const top = max > 0 ? max : 1;
  // One reading has no run to draw, so it becomes a flat line at its own
  // height — which is true, and reads as "steady" rather than as absent.
  if (series.length === 1) {
    const y = height - (Math.min(series[0], top) / top) * height;
    return [
      [0, y],
      [width, y],
    ];
  }

  const step = width / (series.length - 1);
  return series.map((value, i) => {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(value, top)) : 0;
    return [i * step, height - (safe / top) * height];
  });
}

/** The same points as the `points` attribute of a `<polyline>`. */
export function sparkLine(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${round(x)},${round(y)}`).join(" ");
}

/**
 * The line closed into a shape, so it can be filled.
 *
 * Down to the floor at each end and back along it. Drawn under the line, it
 * is what makes a sparkline read as a quantity rather than as a squiggle.
 */
export function sparkArea(points: Array<[number, number]>, height = SPARK_HEIGHT): string {
  if (points.length === 0) return "";
  const first = points[0];
  const last = points[points.length - 1];
  const run = points.map(([x, y]) => `L${round(x)},${round(y)}`).join(" ");
  return `M${round(first[0])},${round(height)} ${run} L${round(last[0])},${round(height)} Z`;
}

/** Two decimals is more than a 100-unit box can show, and keeps the path short. */
function round(n: number): number {
  return Math.round(n * 100) / 100;
}
