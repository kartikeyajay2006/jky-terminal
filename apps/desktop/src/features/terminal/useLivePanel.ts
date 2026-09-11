import { useCallback, useEffect, useRef, useState } from "react";
import { getPlatform } from "../../platform";
import { recognise, type Recognised } from "./recognise";
import { LIVE_EVERY_MS, liveSourceFor } from "./live";

export interface LivePanel {
  /** The source this command maps to, or null when it maps to none. */
  source: string | null;
  on: boolean;
  /** The command that would actually be re-run. */
  shown: string;
  /** When the answer on screen was last asked for. */
  at: number | null;
  /** Why it stopped, when it stopped itself. */
  error: string | null;
  toggle: () => void;
  /** A fresher view of the same command, or null while there is none. */
  fresh: Recognised | null;
}

/**
 * Keeping one panel current.
 *
 * A panel is a photograph: parsed once from the run that produced it and
 * never again. This re-runs the command and re-parses the answer with exactly
 * the same recogniser, so nothing about what is shown changes except that it
 * is true now.
 *
 * Three rules keep it honest, and all three matter:
 *
 * - It is off unless asked. A terminal that started running things on a timer
 *   because you typed `df` would be one you had to be careful in.
 * - It only offers itself for commands Rust knows how to run again by name,
 *   and only when what was typed is exactly one of them — so a panel never
 *   refreshes with a different question from the one on screen.
 * - It stops on the first refusal rather than retrying. A command that has
 *   started failing will keep failing, and something re-running it every two
 *   seconds for ever is a thing nobody asked for.
 */
export function useLivePanel(command: string, active: boolean): LivePanel {
  const source = liveSourceFor(command);
  const [on, setOn] = useState(false);
  const [fresh, setFresh] = useState<Recognised | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Kept so an unmount between the ask and the answer sets no state. */
  const live = useRef(true);

  // A different command means a different panel, so nothing carries over.
  useEffect(() => {
    setOn(false);
    setFresh(null);
    setAt(null);
    setError(null);
  }, [command]);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    // Paused with the pane, so a panel behind a tab nobody is looking at is
    // not running a command every two seconds.
    if (!on || !source || !active) return;

    let stopped = false;

    async function ask() {
      try {
        const run = await getPlatform().live.run(source!);
        if (stopped || !live.current) return;

        if (run.code !== 0) {
          // The command itself refused — no daemon, no permission. Said
          // rather than shown as a stale answer for ever.
          setError(run.text.trim().split("\n")[0] || `exit ${run.code}`);
          setOn(false);
          return;
        }

        const next = recognise({ command, code: 0, output: run.text, cwd: "" });
        setAt(Date.now());
        // A refresh the recogniser declines leaves what is on screen alone.
        // Output that stopped looking like what it expects is a reason to
        // stop, not a reason to show nothing.
        if (next) setFresh(next);
        else {
          setError("the output stopped looking like what it was");
          setOn(false);
        }
      } catch (e) {
        if (stopped || !live.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setOn(false);
      }
    }

    void ask();
    const timer = setInterval(() => void ask(), LIVE_EVERY_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [on, source, active, command]);

  const toggle = useCallback(() => {
    setError(null);
    setOn((was) => !was);
  }, []);

  return {
    source,
    on,
    shown: source ?? command,
    at,
    error,
    toggle,
    fresh: on ? fresh : null,
  };
}
