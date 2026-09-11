/**
 * A session as a shape.
 *
 * The shell says exactly where each command began and how it ended, so the
 * afternoon you have just had is already recorded — nothing here measures
 * anything, it only decides how tall each command should be drawn.
 *
 * Kept apart from the drawing because the awkward parts are arithmetic: a
 * command that has not finished, one that took no measurable time, one from a
 * shell that reported no status at all.
 *
 * Named for the marks rather than the strip so it cannot collide with
 * `Timeline.tsx` on a filesystem that ignores case — which is most of them.
 */

/** One command, as the strip draws it. */
export interface Tick {
  /** Distinct within a session, so React and selection have something stable. */
  id: string;
  /** What was typed. */
  command: string;
  /** Zero worked; null means the shell said nothing. */
  code: number | null;
  /** Milliseconds, or null while it is still going. */
  took: number | null;
  /** The line its prompt is on, for jumping to it. */
  line: number;
  at: number;
}

export type Tone = "ok" | "failed" | "running";

/** How a tick is coloured. */
export function toneOf(tick: Tick): Tone {
  if (tick.took === null) return "running";
  // A shell that reported no status is not a shell reporting success, but it
  // is not reporting a failure either — and marking it red would cry wolf on
  // every command run under a shell this app cannot hook.
  return tick.code !== null && tick.code !== 0 ? "failed" : "ok";
}

/** The longest a strip remembers. Beyond this is a log, not a shape. */
export const MAX_TICKS = 200;

/**
 * The shortest and tallest a tick may be drawn, in pixels.
 *
 * A floor because a command that took four milliseconds still happened and
 * has to be clickable; a ceiling because one command that took an hour would
 * otherwise be the whole strip and every other command a hairline.
 */
export const MIN_TICK = 3;
export const MAX_TICK = 44;

/**
 * How tall one command is drawn, against the longest in the session.
 *
 * Logarithmic, not linear and not square-rooted. A session is usually a
 * hundred commands under a second and one build of four minutes — a range of
 * a thousand to one. Drawn in proportion the hundred are invisible; even
 * square-rooted a two-hundred-millisecond command is four pixels beside a
 * four-minute one. A log keeps the long one obviously longest while leaving
 * the short ones readable, which is the whole point of the strip.
 */
export function heightOf(took: number | null, longest: number): number {
  if (took === null) return MAX_TICK;
  if (!Number.isFinite(took) || took <= 0) return MIN_TICK;

  const top = Number.isFinite(longest) && longest > 0 ? longest : took;
  const share = Math.min(1, Math.log1p(took) / Math.log1p(top));
  return Math.round(MIN_TICK + share * (MAX_TICK - MIN_TICK));
}

/** The longest command in a session, for scaling the rest against. */
export function longestOf(ticks: readonly Tick[]): number {
  return ticks.reduce((high, t) => (t.took !== null && t.took > high ? t.took : high), 0);
}

/** Keep the most recent `MAX_TICKS`, oldest first. */
export function pushTick(ticks: readonly Tick[], tick: Tick): Tick[] {
  const kept = [...ticks, tick];
  return kept.length > MAX_TICKS ? kept.slice(kept.length - MAX_TICKS) : kept;
}

/** How long it took, in the roughest unit that is still true. */
export function tookText(took: number | null): string {
  if (took === null) return "still running";
  if (took < 1000) return `${Math.max(1, Math.round(took))}ms`;
  if (took < 60_000) return `${(took / 1000).toFixed(1)}s`;

  const minutes = Math.floor(took / 60_000);
  const seconds = Math.round((took % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}
