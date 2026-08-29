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
    note: "JetBrains Mono, then whatever this machine has",
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
    id: "cascadia",
    label: "Cascadia Code",
    stack: '"Cascadia Code", "Cascadia Mono", ui-monospace, monospace',
    note: "Ships with Windows Terminal",
  },
  {
    id: "sf",
    label: "SF Mono",
    stack: '"SF Mono", ui-monospace, Menlo, monospace',
    note: "The macOS terminal face",
  },
  {
    id: "ubuntu",
    label: "Ubuntu Mono",
    stack: '"Ubuntu Mono", ui-monospace, monospace',
    note: "Narrow, so more fits across",
  },
  {
    id: "courier",
    label: "Courier New",
    stack: '"Courier New", Courier, monospace',
    note: "On every machine ever made",
  },
];

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
