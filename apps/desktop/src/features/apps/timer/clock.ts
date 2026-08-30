/**
 * The Timer app's clock.
 *
 * Every function here is pure and takes `now` as an argument. That is what
 * makes the whole thing testable without waiting for real seconds to pass,
 * and it is also what keeps the timer honest: the count is derived from two
 * timestamps rather than accumulated by a tick handler, so a dropped frame, a
 * backgrounded window or a machine under load cannot make it disagree with
 * the clock on the wall. A `setInterval` that adds a second each time it fires
 * is wrong by however much the browser delayed it, and it never catches up.
 */

export interface TimerState {
  /** How long the timer is set for. Zero means nothing is set. */
  durationMs: number;
  /** When the current run began, or null when it is not running. */
  startedAt: number | null;
  /** Time banked by previous runs, before the current one. */
  bankedMs: number;
}

export function newTimer(durationMs: number): TimerState {
  return { durationMs, startedAt: null, bankedMs: 0 };
}

export function isRunning(state: TimerState): boolean {
  return state.startedAt !== null;
}

export function elapsed(state: TimerState, now: number): number {
  if (state.startedAt === null) return state.bankedMs;
  return state.bankedMs + (now - state.startedAt);
}

export function remaining(state: TimerState, now: number): number {
  // Clamped at zero: a countdown that goes negative is showing a number that
  // is no longer counting down to anything.
  return Math.max(0, state.durationMs - elapsed(state, now));
}

export function isFinished(state: TimerState, now: number): boolean {
  if (state.durationMs <= 0) return false;
  // Never started is not finished, however long ago that was.
  if (state.startedAt === null && state.bankedMs === 0) return false;
  return remaining(state, now) === 0;
}

export function start(state: TimerState, now: number): TimerState {
  if (state.startedAt !== null) return state;
  return { ...state, startedAt: now };
}

export function pause(state: TimerState, now: number): TimerState {
  if (state.startedAt === null) return state;
  return { durationMs: state.durationMs, startedAt: null, bankedMs: elapsed(state, now) };
}

export function reset(state: TimerState): TimerState {
  return newTimer(state.durationMs);
}

export function setDuration(state: TimerState, durationMs: number): TimerState {
  void state;
  return newTimer(durationMs);
}

/**
 * A duration as the display shows it.
 *
 * Part-seconds round up, so the last second of a run reads "00:01" rather
 * than "00:00" — a timer that shows zero while it is still going has already
 * lied about being finished.
 */
export function formatDuration(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  // The hours field appears only when there are hours: a five-minute timer
  // reading "0:05:00" pads the display with a zero nobody needed.
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Read a duration a person typed.
 *
 * A bare number is minutes, because that is what someone setting a timer
 * means by "10". Anything with colons is a clock reading.
 */
export function parseDuration(input: string): number | null {
  const text = input.trim();
  if (text === "") return null;

  const parts = text.split(":");
  if (parts.length > 3) return null;
  if (!parts.every((p) => /^\d+$/.test(p))) return null;

  const numbers = parts.map(Number);

  if (numbers.length === 1) return numbers[0] * 60_000;

  // Every field below the leading one is a clock field, so 75 seconds is a
  // typo rather than a minute and a quarter — reading it as the latter would
  // silently set a different timer than the one that was typed.
  const tail = numbers.slice(1);
  if (tail.some((n) => n > 59)) return null;

  if (numbers.length === 2) return (numbers[0] * 60 + numbers[1]) * 1000;
  return (numbers[0] * 3600 + numbers[1] * 60 + numbers[2]) * 1000;
}
