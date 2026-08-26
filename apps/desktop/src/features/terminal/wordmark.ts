/**
 * The JKY wordmark.
 *
 * Two layers share one grid. `█` is the face of each letter; the box-drawing
 * characters are its bevel. Drawing the bevel at a fraction of the face's
 * brightness is what gives the mark depth — a flat single-weight block letter
 * reads as ASCII art, a two-weight one reads as a logo.
 */
export const WORDMARK = [
  "      ██╗██╗  ██╗██╗   ██╗",
  "      ██║██║ ██╔╝╚██╗ ██╔╝",
  "      ██║█████╔╝  ╚████╔╝ ",
  " ██   ██║██╔═██╗   ╚██╔╝  ",
  " ╚█████╔╝██║  ██╗   ██║   ",
  "  ╚════╝ ╚═╝  ╚═╝   ╚═╝   ",
];

export const WORDMARK_WIDTH = 26;

/** The bevel characters, which render dimmer than the letter faces. */
const BEVEL = new Set(["╗", "╔", "╝", "╚", "═", "║", "╞", "╡"]);

export function isBevel(ch: string): boolean {
  return BEVEL.has(ch);
}

export function isFace(ch: string): boolean {
  return ch === "█";
}
