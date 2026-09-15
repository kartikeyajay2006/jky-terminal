import type { ITheme } from "@xterm/xterm";

/**
 * The terminal's colours, taken from the active theme.
 *
 * Without this xterm paints its own black and white, so a light theme showed a
 * black box in the middle of a light window — the one part of the app that
 * ignored the choice. Every colour here is read from a theme token instead,
 * and the terminal repaints when the theme changes.
 *
 * Only tokens that `styles/contrast.test.ts` measures against each theme's
 * ground are used for anything a character is drawn in. That test is what
 * keeps them readable, so a terminal colour borrowed from one of them is
 * readable in every theme by construction rather than by someone checking.
 */

type Field = keyof ITheme;

/**
 * Which token each colour comes from.
 *
 * The sixteen ANSI colours are named for what programs use them for rather
 * than for the hue: "black" is how a program says de-emphasised and "white"
 * how it says ordinary, which is why they map to the dim and muted text
 * tokens — the literal colours would vanish against a light ground.
 */
const SOURCES: ReadonlyArray<[Field, string]> = [
  ["background", "--ground"],
  ["foreground", "--text"],
  ["cursor", "--accent"],
  // The character under a block cursor, which sits on the accent.
  ["cursorAccent", "--ground"],
  // A tint, not a fill: a selected cell keeps its own measured colour, where
  // forcing one foreground onto every selection would pair text with a
  // background nothing has measured.
  ["selectionBackground", "--accent-glow"],
  ["selectionInactiveBackground", "--accent-glow"],

  ["black", "--text-dim"],
  ["red", "--danger"],
  ["green", "--mint"],
  ["yellow", "--warn"],
  ["blue", "--accent"],
  ["magenta", "--magenta"],
  ["cyan", "--accent-dim"],
  ["white", "--text-muted"],

  ["brightBlack", "--text-dim"],
  ["brightRed", "--danger"],
  ["brightGreen", "--lime"],
  ["brightYellow", "--warn"],
  ["brightBlue", "--violet"],
  ["brightMagenta", "--magenta"],
  ["brightCyan", "--accent"],
  ["brightWhite", "--text"],
];

/**
 * Build xterm's theme from whatever `read` returns for each token.
 *
 * A token that cannot be read is left out, so xterm keeps its own colour for
 * that one slot. Inventing a fallback here would put a literal colour outside
 * the stylesheets allowed to hold them.
 */
export function terminalColours(read: (token: string) => string): ITheme {
  const theme: Record<string, string> = {};
  for (const [field, token] of SOURCES) {
    const value = read(token).trim();
    if (value) theme[field] = value;
  }
  return theme as ITheme;
}
