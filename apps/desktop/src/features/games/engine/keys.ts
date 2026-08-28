import { useEffect, useRef } from "react";

/** The keys a game claims, and which the page must not also act on. */
export const GAME_KEYS = new Set([
  " ",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Enter",
]);

/**
 * Keyboard for a game.
 *
 * Two rules, both of which exist to keep the rest of the app usable while a
 * game is on screen:
 *
 * 1. A held modifier is never a game key. `Ctrl+T` opens a terminal tab and
 *    must keep doing so with a game running — every app shortcut here takes
 *    a modifier, so ignoring modified keys is enough to stay out of the way
 *    entirely.
 * 2. Typing into an input is never a game key, so the reset button's tooltip
 *    or any future text field is not swallowed by a jumping dinosaur.
 *
 * `preventDefault` is called only for the keys a game actually claims —
 * otherwise Space would stop scrolling the page everywhere in the app.
 */
export function useGameKeys(active: boolean, onKey: (key: string) => void): void {
  const handler = useRef(onKey);
  handler.current = onKey;

  useEffect(() => {
    if (!active) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      if (GAME_KEYS.has(e.key)) e.preventDefault();
      handler.current(e.key);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active]);
}

/**
 * The direction a key means, or null when it means nothing.
 *
 * Arrows and WASD both, because half of everyone reaches for one and half for
 * the other, and a game that only accepts one feels broken to the other half.
 */
export function directionFor(key: string): "up" | "down" | "left" | "right" | null {
  switch (key) {
    case "ArrowUp":
    case "w":
    case "W":
      return "up";
    case "ArrowDown":
    case "s":
    case "S":
      return "down";
    case "ArrowLeft":
    case "a":
    case "A":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
      return "right";
    default:
      return null;
  }
}

/** Does this key mean "go", for a game waiting to start or resume? */
export function isActionKey(key: string): boolean {
  return key === " " || key === "Enter";
}
