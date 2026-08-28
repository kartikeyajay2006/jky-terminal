import { useEffect, useImperativeHandle, useRef, forwardRef } from "react";
import type { Grid } from "./engine/grid";

export interface GameScreenHandle {
  /** Push a freshly painted grid to the DOM. Called once per frame. */
  draw: (grid: Grid) => void;
}

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
 * The markup the grid produces is generated entirely by `Grid.toHtml`, which
 * escapes every character it did not write itself — no game passes user text
 * through here.
 */
export const GameScreen = forwardRef<GameScreenHandle, { label: string }>(
  function GameScreen({ label }, ref) {
    const screen = useRef<HTMLPreElement>(null);
    const last = useRef("");

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
    }));

    // Belt and braces for the very first paint: without this a game that
    // draws only on state change would show an empty box until something
    // moved.
    useEffect(() => {
      last.current = "";
    }, []);

    return (
      <pre
        ref={screen}
        className="gamescreen"
        aria-label={label}
        role="img"
        tabIndex={-1}
      />
    );
  },
);
