import { useEffect, useState, type KeyboardEvent } from "react";
import {
  elapsed,
  formatDuration,
  isFinished,
  isRunning,
  newTimer,
  parseDuration,
  pause,
  remaining,
  reset,
  setDuration,
  start,
  type TimerState,
} from "./clock";

const MINUTE = 60_000;
const DEFAULT_MS = 5 * MINUTE;

const PRESETS = [1, 5, 10, 25];

/** How often the display is repainted while running. */
const TICK_MS = 250;

/**
 * A short tone when the time is up.
 *
 * Synthesised rather than played from a file: an audio asset would be one more
 * thing in a bundle already at its budget, and this is two sine-wave seconds.
 * Everything is guarded — a runtime with no Web Audio (jsdom, or a browser
 * that has not had a user gesture yet) simply gets the banner instead, which
 * is the part that actually matters.
 */
function chime() {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = "sine";
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    // Ramped rather than switched on: a square edge on a sine is a click.
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.7);

    osc.start();
    osc.stop(ctx.currentTime + 0.7);
    osc.onended = () => void ctx.close();
  } catch {
    // No sound. The banner still says what happened.
  }
}

/**
 * The Timer app.
 *
 * The clock lives in `clock.ts` and is pure; this holds the current time in
 * state and repaints four times a second. The count itself is never
 * accumulated here — it is always derived from `now`, so a tick that arrives
 * late or not at all costs a frame of smoothness rather than a second of
 * accuracy.
 */
export function Timer() {
  const [timer, setTimer] = useState<TimerState>(() => newTimer(DEFAULT_MS));
  const [now, setNow] = useState(() => Date.now());
  const [entry, setEntry] = useState("5");
  const [entryError, setEntryError] = useState(false);

  const finished = isFinished(timer, now);
  const running = isRunning(timer) && !finished;
  const left = remaining(timer, now);

  // The repaint stops when the timer does, so a finished or paused timer is
  // not waking the machine four times a second to draw the same digits.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (finished) chime();
  }, [finished]);

  function toggle() {
    const at = Date.now();
    setNow(at);
    setTimer((t) => {
      if (isRunning(t) && !isFinished(t, at)) return pause(t, at);
      // Starting a finished timer runs it again, rather than leaving it
      // sitting on "time's up" while the button offers to start it.
      return isFinished(t, at) ? start(reset(t), at) : start(t, at);
    });
  }

  function applyDuration(ms: number) {
    setNow(Date.now());
    setTimer((t) => setDuration(t, ms));
    setEntryError(false);
  }

  function commitEntry() {
    const ms = parseDuration(entry);
    if (ms === null || ms <= 0) {
      setEntryError(true);
      return;
    }
    applyDuration(ms);
  }

  function onEntryKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    commitEntry();
  }

  return (
    <div className="timer">
      <div className="timer__face" data-finished={finished ? "" : undefined}>
        {/* Deliberately not a live region: announcing every second would make
            a screen reader unusable. The banner below is the announcement. */}
        <output className="timer__display" aria-label="Time remaining">
          {formatDuration(left)}
        </output>
        <div className="timer__track" aria-hidden="true">
          <div className="timer__fill" style={{ width: `${progress(timer, now)}%` }} />
        </div>
      </div>

      {finished && (
        <p className="timer__done" role="alert">
          Time&rsquo;s up
        </p>
      )}

      <div className="timer__controls">
        <button type="button" className="timer__primary" onClick={toggle}>
          {running ? "Pause" : "Start"}
        </button>
        <button
          type="button"
          className="timer__secondary"
          onClick={() => {
            setNow(Date.now());
            setTimer(reset);
          }}
        >
          Reset
        </button>
      </div>

      <div className="timer__presets">
        {PRESETS.map((m) => (
          <button
            key={m}
            type="button"
            className="timer__preset"
            onClick={() => applyDuration(m * MINUTE)}
          >
            {m} {m === 1 ? "minute" : "minutes"}
          </button>
        ))}
      </div>

      <div className="timer__entry">
        <input
          className="timer__input"
          aria-label="Set a time"
          value={entry}
          spellCheck={false}
          autoComplete="off"
          placeholder="5 or 2:30"
          onChange={(e) => {
            setEntry(e.target.value);
            setEntryError(false);
          }}
          onKeyDown={onEntryKeyDown}
        />
        <button type="button" className="timer__set" onClick={commitEntry}>
          Set
        </button>
      </div>
      {entryError && (
        <p className="timer__hint" role="status">
          Try minutes, or mm:ss.
        </p>
      )}
    </div>
  );
}

/** How much of the set time has gone, as a percentage. */
function progress(timer: TimerState, now: number): number {
  if (timer.durationMs <= 0) return 0;
  const done = Math.min(1, elapsed(timer, now) / timer.durationMs);
  return done * 100;
}
