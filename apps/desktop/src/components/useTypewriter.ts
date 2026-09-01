import { useEffect, useRef, useState } from "react";

/**
 * Text arriving the way a terminal prints it.
 *
 * The answer under a failed command is written into a terminal, and text that
 * simply appears there reads as something that was always on screen. Typed
 * out, it reads as an answer arriving — which is what it is.
 *
 * Bounded on purpose. It types by the clock rather than by the frame, so a
 * slow machine shows the same thing at the same speed as a fast one; and it
 * types in chunks rather than one character per tick, so a long answer takes
 * about as long as a short one rather than the length of an actual reply.
 *
 * `prefers-reduced-motion` skips it entirely. This is motion in the strictest
 * sense — text moving — and someone who asked for less of it should see the
 * answer, not watch it.
 */
const TICK_MS = 16;
const WHOLE_MS = 450;

export function useTypewriter(text: string, enabled = true): string {
  const [shown, setShown] = useState(() => (enabled ? "" : text));
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const wants =
      enabled &&
      text.length > 0 &&
      !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (!wants) {
      setShown(text);
      return;
    }

    setShown("");
    // Sized so the whole answer lands in about the same time whatever its
    // length: a long one typed a character at a time is a wait, not an effect.
    const perTick = Math.max(1, Math.ceil(text.length / (WHOLE_MS / TICK_MS)));
    let at = 0;

    timer.current = setInterval(() => {
      at = Math.min(text.length, at + perTick);
      setShown(text.slice(0, at));
      if (at >= text.length && timer.current) clearInterval(timer.current);
    }, TICK_MS);

    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [text, enabled]);

  return shown;
}
