/**
 * The site's themes are the app's themes: the same seven ids and names, read
 * from the app's theme.ts, and the same token sets, from its themes.css. A
 * theme is applied the way the app applies one — a data-theme attribute on
 * the root — so every colour on the page changes at once.
 *
 * The change is revealed as a circle growing from wherever it was asked for
 * (the pointer, or the terminal's cursor), using the View Transitions API
 * where the browser has it, and simply happens where it does not.
 */
import { THEMES } from "../../../desktop/src/app/theme";

export const themes = THEMES.map(({ id, label }) => ({ id, label }));
export type ThemeId = (typeof THEMES)[number]["id"];

const KEY = "jky.theme";

export function currentTheme(): string {
  return document.documentElement.dataset.theme ?? "cyberpunk";
}

export function isTheme(id: string): id is ThemeId {
  return themes.some((t) => t.id === id);
}

export function labelOf(id: string): string {
  return themes.find((t) => t.id === id)?.label ?? id;
}

interface Options {
  /** Where the reveal grows from, in viewport pixels. */
  x?: number;
  y?: number;
  /** Remember it for the next visit. A demo that switches and back does not. */
  persist?: boolean;
  /** No reveal: for a change the visitor is not looking at. */
  instant?: boolean;
}

export function setTheme(id: string, opts: Options = {}): Promise<void> {
  if (!isTheme(id)) return Promise.resolve();
  const root = document.documentElement;
  if (opts.persist !== false) {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* a private window: the theme still changes, it just is not kept */
    }
  }
  if (root.dataset.theme === id) return Promise.resolve();

  const apply = () => {
    root.dataset.theme = id;
    window.dispatchEvent(new CustomEvent("jky:theme", { detail: id }));
  };

  const doc = document as Document & {
    startViewTransition?: (update: () => void) => { ready: Promise<void>; finished: Promise<void> };
  };
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!doc.startViewTransition || still || opts.instant) {
    apply();
    return Promise.resolve();
  }

  const x = opts.x ?? innerWidth / 2;
  const y = opts.y ?? innerHeight / 2;
  const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const transition = doc.startViewTransition(apply);
  transition.ready
    .then(() => {
      root.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 1050, easing: "cubic-bezier(0.7, 0, 0.25, 1)", pseudoElement: "::view-transition-new(root)" },
      );
    })
    .catch(() => {});
  return transition.finished.catch(() => {});
}

/** The inline <head> script: the saved theme before first paint, so no flash. */
export const THEME_BOOT = `try{var t=localStorage.getItem("${KEY}");if(t&&/^(${themes
  .map((t) => t.id)
  .join("|")})$/.test(t))document.documentElement.dataset.theme=t}catch(e){}document.documentElement.classList.add("js");`;
