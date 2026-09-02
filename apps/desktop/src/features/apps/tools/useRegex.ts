import { useCallback, useEffect, useRef, useState } from "react";
import type { RegexResult } from "./regexEngine";

/**
 * How long a pattern gets before it is assumed never to finish.
 *
 * Generous — a real search over a large document is nowhere near this — and
 * short enough that a runaway does not feel like a hang before it is dealt
 * with.
 */
const GIVE_UP_MS = 2000;

/**
 * Run a pattern in a worker, and kill it if it will not finish.
 *
 * The whole reason for the worker. `(a+)+$` against a long run of a's takes
 * longer than the universe to fail, and a regular expression cannot be
 * interrupted once it has started — there is no yield point to check a flag
 * at. On the main thread that is a frozen window with no way out. In a
 * worker it is a thread that can be terminated, which is the only way to stop
 * one at all.
 *
 * The worker is injected rather than constructed here so tests can supply one
 * that answers on demand; jsdom has no `Worker`, and a hook that quietly fell
 * back to the main thread would test the exact thing this exists to prevent.
 */
export function useRegex(makeWorker: () => Worker = defaultWorker) {
  const [result, setResult] = useState<RegexResult | null>(null);
  const [busy, setBusy] = useState(false);

  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Which run the answer must belong to, so a late one is ignored. */
  const generation = useRef(0);

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    worker.current?.terminate();
    worker.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const run = useCallback(
    (pattern: string, flags: string, text: string) => {
      // Nothing typed is not a question, and answering it would flash a
      // result at someone mid-thought.
      if (pattern === "") {
        stop();
        setBusy(false);
        setResult(null);
        return;
      }

      // A terminated worker cannot be reused, and a running one is answering
      // a question nobody is asking any more.
      stop();
      generation.current += 1;
      const mine = generation.current;

      const next = makeWorker();
      worker.current = next;
      setBusy(true);

      next.onmessage = (event: MessageEvent<RegexResult>) => {
        if (mine !== generation.current) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setResult(event.data);
        setBusy(false);
      };

      timer.current = setTimeout(() => {
        if (mine !== generation.current) return;
        // Bumped first, so an answer racing in behind the kill is ignored.
        generation.current += 1;
        stop();
        setResult({
          ok: false,
          message:
            "that pattern took too long and was stopped — it is probably backtracking. " +
            "Try making a repeated group less ambiguous.",
        });
        setBusy(false);
      }, GIVE_UP_MS);

      next.postMessage({ pattern, flags, text });
    },
    [makeWorker, stop],
  );

  return { result, busy, run };
}

function defaultWorker(): Worker {
  return new Worker(new URL("./regex.worker.ts", import.meta.url), { type: "module" });
}
