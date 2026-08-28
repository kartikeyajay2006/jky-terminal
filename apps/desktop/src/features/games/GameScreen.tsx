import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { Grid } from "./engine/grid";

export type FlashTone = "danger" | "mint" | "warn" | "accent";

export interface GameScreenHandle {
  /** Push a freshly painted grid to the DOM. Called once per frame. */
  draw: (grid: Grid) => void;
  /** Rattle the screen. For a hit, a death, or anything that should sting. */
  shake: (strength?: "small" | "big") => void;
  /** Wash the screen in a colour for a moment. */
  flash: (tone: FlashTone) => void;
}

/** Roughly the length of the CSS animations below, so classes are cleared. */
const SHAKE_MS = 420;
const FLASH_MS = 320;

/**
 * The screen a game paints on.
 *
 * The whole reason this is a component with an imperative handle rather than
 * a `<pre>{html}</pre>` driven by state: a game redraws sixty times a second,
 * and routing each of those frames through React means sixty reconciliations
 * a second for a subtree whose entire content is replaced anyway. Writing to
 * `innerHTML` directly skips all of it, and React never has to know the
 * picture changed.
 *
 * Shake and flash go through the same door for the same reason, and are done
 * as CSS classes rather than by moving cells: a transform runs on the
 * compositor and costs the game loop nothing, while shifting the grid would
 * mean repainting every character for a purely decorative wobble.
 *
 * The markup the grid produces is generated entirely by `Grid.toHtml`, which
 * escapes every character it did not write itself — no game passes user text
 * through here.
 */
export const GameScreen = forwardRef<GameScreenHandle, { label: string }>(
  function GameScreen({ label }, ref) {
    const frame = useRef<HTMLDivElement>(null);
    const screen = useRef<HTMLPreElement>(null);
    const flashLayer = useRef<HTMLSpanElement>(null);
    const last = useRef("");
    const timers = useRef<number[]>([]);

    useImperativeHandle(ref, () => ({
      draw(grid) {
        const html = grid.toHtml();
        // A frame in which nothing moved is common — a paused game, a menu,
        // a board waiting for a keypress — and rewriting identical markup
        // makes the browser re-layout for nothing.
        if (html === last.current) return;
        last.current = html;
        if (screen.current) screen.current.innerHTML = html;
      },

      shake(strength = "small") {
        const el = frame.current;
        if (!el) return;
        const cls = strength === "big" ? "gamescreen__frame--shake-big" : "gamescreen__frame--shake";
        // Removed and forced to reflow before re-adding, or a second hit
        // during the first shake restarts nothing and the screen sits still
        // at exactly the moment it should be rattling hardest.
        el.classList.remove("gamescreen__frame--shake", "gamescreen__frame--shake-big");
        void el.offsetWidth;
        el.classList.add(cls);
        timers.current.push(
          window.setTimeout(() => el.classList.remove(cls), SHAKE_MS),
        );
      },

      flash(tone) {
        const el = flashLayer.current;
        if (!el) return;
        el.classList.remove("gamescreen__flash--on");
        el.dataset.tone = tone;
        void el.offsetWidth;
        el.classList.add("gamescreen__flash--on");
        timers.current.push(
          window.setTimeout(() => el.classList.remove("gamescreen__flash--on"), FLASH_MS),
        );
      },
    }));

    useEffect(() => {
      last.current = "";
      const pending = timers.current;
      // Timers outliving the component would touch a detached node, which is
      // harmless but is also exactly the kind of thing that turns into a leak
      // once someone adds state to the callback.
      return () => pending.forEach(window.clearTimeout);
    }, []);

    return (
      <div className="gamescreen__frame" ref={frame}>
        <pre
          ref={screen}
          className="gamescreen"
          aria-label={label}
          role="img"
          tabIndex={-1}
        />
        {/* Purely decorative, and inert to the pointer so it cannot eat a
            click meant for the board underneath. */}
        <span className="gamescreen__scanlines" aria-hidden="true" />
        <span className="gamescreen__vignette" aria-hidden="true" />
        <span className="gamescreen__flash" ref={flashLayer} aria-hidden="true" />
      </div>
    );
  },
);
