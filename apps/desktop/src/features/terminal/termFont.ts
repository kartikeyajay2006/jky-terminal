/**
 * How the terminal is set: its size, and which monospace face it uses.
 *
 * Alongside the theme in browser storage rather than in `jky-store`, for the
 * same reason: it is how this copy of the app is set up, not content anyone
 * would expect to find listed somewhere.
 */

const KEY = "jky.terminal.font";

export interface TermFont {
  /** Points. Bounded, because either extreme makes a terminal unusable. */
  size: number;
  /** The id of one of `TERM_FONTS`, or "system" for the app's own stack. */
  family: string;
}

/**
 * The range the size may take.
 *
 * Below about eight, box-drawing characters stop lining up and a full-screen
 * program like `htop` becomes unreadable. Above about twenty-eight, a
 * standard eighty-column program no longer fits the pane on a normal display,
 * which breaks far more than it helps.
 */
export const MIN_SIZE = 8;
export const MAX_SIZE = 28;
export const DEFAULT_SIZE = 13;

export interface TermFontChoice {
  id: string;
  label: string;
  /**
   * The CSS stack.
   *
   * Every one ends in a generic `monospace`, so a face the machine does not
   * have degrades to *some* monospace rather than to a proportional font —
   * which in a terminal is not a cosmetic problem, it is unusable.
   */
  stack: string;
  note: string;
}

export const TERM_FONTS: TermFontChoice[] = [
  {
    id: "system",
    label: "App default",
    // The token the rest of the app uses, resolved at apply time.
    stack: "",
    note: "Whatever the app's own monospace resolves to on this machine",
  },
  {
    id: "jetbrains",
    label: "JetBrains Mono",
    stack: '"JetBrains Mono", ui-monospace, monospace',
    note: "Tall x-height, easy on long sessions",
  },
  {
    id: "fira",
    label: "Fira Code",
    stack: '"Fira Code", ui-monospace, monospace',
    note: "Ligatures for arrows and comparisons",
  },
  {
    id: "source",
    label: "Source Code Pro",
    stack: '"Source Code Pro", ui-monospace, monospace',
    note: "Adobe's, and widely packaged on Linux",
  },
  {
    id: "dejavu",
    label: "DejaVu Sans Mono",
    stack: '"DejaVu Sans Mono", ui-monospace, monospace',
    note: "On practically every Linux install",
  },
  {
    id: "liberation",
    label: "Liberation Mono",
    stack: '"Liberation Mono", ui-monospace, monospace',
    note: "Metric-compatible with Courier New",
  },
  {
    id: "noto",
    label: "Noto Sans Mono",
    stack: '"Noto Sans Mono", ui-monospace, monospace',
    note: "Very broad character coverage",
  },
  {
    id: "hack",
    label: "Hack",
    stack: '"Hack", ui-monospace, monospace',
    note: "Drawn for source code at small sizes",
  },
  {
    id: "inconsolata",
    label: "Inconsolata",
    stack: '"Inconsolata", ui-monospace, monospace',
    note: "Narrow, so more fits across",
  },
  {
    id: "cascadia",
    label: "Cascadia Code",
    stack: '"Cascadia Code", "Cascadia Mono", ui-monospace, monospace',
    note: "Ships with Windows Terminal",
  },
  {
    id: "consolas",
    label: "Consolas",
    stack: "Consolas, ui-monospace, monospace",
    note: "The Windows standard",
  },
  {
    id: "menlo",
    label: "Menlo",
    stack: "Menlo, ui-monospace, monospace",
    note: "The macOS standard",
  },
  {
    id: "sf",
    label: "SF Mono",
    stack: '"SF Mono", ui-monospace, Menlo, monospace',
    note: "Apple's, if Xcode has put it there",
  },
  {
    id: "courier",
    label: "Courier New",
    stack: '"Courier New", Courier, monospace',
    note: "On every machine ever made",
  },
];

/**
 * Is a face actually on this machine?
 *
 * Worth answering, because a stack that falls back looks like a setting that
 * does nothing: pick a font the machine has never heard of and the terminal
 * carries on in exactly the face it was already using, which reads as a bug
 * rather than as an absent font.
 *
 * Measured rather than asked, since there is no API for it. A string is drawn
 * in a known generic and then in the candidate backed by that same generic; if
 * the candidate exists the widths differ, and if it does not they are
 * identical because the candidate silently resolved to the generic.
 *
 * Returns null when it cannot tell — no canvas, as in jsdom — because "I do
 * not know" and "it is missing" should not look the same to a caller.
 */
export function isFontAvailable(family: string): boolean | null {
  const name = family.trim();
  if (!name) return null;

  let context: CanvasRenderingContext2D | null = null;
  try {
    context = document.createElement("canvas").getContext("2d");
  } catch {
    return null;
  }
  if (!context || typeof context.measureText !== "function") return null;

  // Characters chosen to vary between faces: a wide letter, a narrow one, and
  // digits, which is where monospace designs differ most from each other.
  const sample = "mmmiiilll0123456789WW";

  try {
    for (const generic of ["monospace", "sans-serif", "serif"]) {
      context.font = `72px ${generic}`;
      const base = context.measureText(sample).width;
      if (!base) return null;

      context.font = `72px "${name}", ${generic}`;
      if (context.measureText(sample).width !== base) return true;
    }
  } catch {
    return null;
  }

  return false;
}

/**
 * The first face named in a stack, which is the one being asked for.
 *
 * The rest of a stack is fallbacks, and whether *those* are present is not
 * interesting — one of them always is.
 */
export function primaryFace(stack: string): string {
  const first = stack.split(",")[0] ?? "";
  return first.trim().replace(/^["']|["']$/g, "");
}

export const DEFAULT_FONT: TermFont = { size: DEFAULT_SIZE, family: "system" };

export function clampSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(size)));
}

export function isKnownFamily(id: string): boolean {
  return TERM_FONTS.some((f) => f.id === id);
}

export function loadTermFont(): TermFont {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_FONT };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_FONT };
    const v = parsed as Record<string, unknown>;
    return {
      size: typeof v.size === "number" ? clampSize(v.size) : DEFAULT_SIZE,
      family:
        typeof v.family === "string" && isKnownFamily(v.family)
          ? v.family
          : DEFAULT_FONT.family,
    };
  } catch {
    return { ...DEFAULT_FONT };
  }
}

export function saveTermFont(font: TermFont): TermFont {
  const clean: TermFont = {
    size: clampSize(font.size),
    family: isKnownFamily(font.family) ? font.family : DEFAULT_FONT.family,
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Preference lost, terminal fine.
  }
  return clean;
}

/**
 * The CSS font stack for a choice.
 *
 * "App default" resolves the `--font-mono` token at call time, so it follows
 * the app rather than pinning a copy of it that would drift.
 */
export function stackFor(family: string, fallback = "monospace"): string {
  const choice = TERM_FONTS.find((f) => f.id === family);
  if (choice && choice.stack) return choice.stack;

  const token = getComputedStyle(document.documentElement)
    .getPropertyValue("--font-mono")
    .trim();
  return token || fallback;
}

/**
 * Broadcast that the terminal font changed.
 *
 * A plain DOM event rather than a store, because the listeners are xterm
 * instances rather than React components — they live outside the render tree
 * entirely, and giving them a store subscription would mean a component
 * re-rendering to tell an object about a change it could hear itself.
 */
export const TERM_FONT_EVENT = "jky:termfont";

export function announceTermFont(font: TermFont): void {
  window.dispatchEvent(new CustomEvent<TermFont>(TERM_FONT_EVENT, { detail: font }));
}
