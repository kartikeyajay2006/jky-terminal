/**
 * The greeting written into a terminal when it opens.
 *
 * This is real ANSI written into the pty stream, not a React overlay, so it
 * sits in the scrollback like any other output — scroll up and it is still
 * there, exactly the way a shell MOTD behaves.
 *
 * Colours are read from the live theme tokens rather than hard-coded, so the
 * wordmark recolours itself when the theme changes. When a token cannot be
 * read the banner prints plain, because inventing a fallback colour here
 * would put a literal outside the one file allowed to hold them.
 */

import { WORDMARK, WORDMARK_WIDTH, isBevel } from "./wordmark";

const ESC = "\u001b";
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;
const BOLD = `${ESC}[1m`;

export type Rgb = [number, number, number];

export interface BannerPalette {
  accent: string;
  violet: string;
  magenta: string;
}

export interface BannerOptions {
  cols: number;
  version: string;
  palette: BannerPalette;
}

/** Parse `#rgb` or `#rrggbb`. Returns null for anything else, including rgba(). */
export function parseHex(value: string): Rgb | null {
  const hex = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(hex);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (long) {
    return [parseInt(long[1], 16), parseInt(long[2], 16), parseInt(long[3], 16)];
  }
  return null;
}

/** A 24-bit foreground colour escape. */
export function hexToAnsi([r, g, b]: Rgb): string {
  return `${ESC}[38;2;${r};${g};${b}m`;
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Scale a colour toward black. Used to sink the bevel behind the face. */
export function shade(colour: Rgb, factor: number): Rgb {
  return [
    Math.round(colour[0] * factor),
    Math.round(colour[1] * factor),
    Math.round(colour[2] * factor),
  ];
}

/** Sample a multi-stop ramp at `t` in [0, 1]. */
function ramp(stops: Rgb[], t: number): Rgb {
  if (stops.length === 1) return stops[0];
  const scaled = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(scaled);
  return mix(stops[i], stops[i + 1], scaled - i);
}

/** How far the bevel is sunk behind the letter face. */
const BEVEL_SHADE = 0.42;

/**
 * Draw one row of the wordmark.
 *
 * The gradient runs diagonally rather than straight across: sampling on
 * `x + y` means the ramp travels through the mark instead of banding each row
 * identically, which is what makes it read as lit rather than striped.
 */
function drawRow(row: string, rowIndex: number, rows: number, stops: Rgb[]): string {
  let out = "";
  let current = "";

  for (let x = 0; x < row.length; x++) {
    const ch = row[x];
    if (ch === " ") {
      out += ch;
      continue;
    }

    // Weight x more heavily than y so the ramp still reads left-to-right,
    // with just enough vertical drift to feel like light falling across it.
    const t =
      (x / Math.max(1, WORDMARK_WIDTH - 1)) * 0.82 +
      (rowIndex / Math.max(1, rows - 1)) * 0.18;

    const base = ramp(stops, t);
    const colour = hexToAnsi(isBevel(ch) ? shade(base, BEVEL_SHADE) : base);

    if (colour !== current) {
      out += colour;
      current = colour;
    }
    out += ch;
  }
  return out;
}

/** Cut a line to `width` visible characters, ignoring escape sequences. */
function fitToWidth(line: string, width: number): string {
  let visible = 0;
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (line[i] === ESC) {
      const end = line.indexOf("m", i);
      if (end === -1) break;
      out += line.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    if (visible >= width) break;
    out += line[i];
    visible++;
    i++;
  }
  return out;
}

const GUTTER = 2;
const TAGLINE = "AI Terminal. Infinite Possibilities.";
const HINTS = "Ctrl+T  new terminal      Ctrl+W  close      Ctrl+1-9  switch";

export function buildBanner({ cols, version, palette }: BannerOptions): string {
  const stops = [palette.accent, palette.violet, palette.magenta]
    .map(parseHex)
    .filter((c): c is Rgb => c !== null);

  const hasColour = stops.length > 0;
  const tint = (text: string, colour?: Rgb) =>
    hasColour ? `${hexToAnsi(colour ?? stops[0])}${text}${RESET}` : text;

  const lines: string[] = [];
  const pad = " ".repeat(GUTTER);
  const inner = Math.max(0, cols - GUTTER * 2);
  const compact = cols < WORDMARK_WIDTH + GUTTER * 2;

  if (compact) {
    // No room for the mark. Say who we are and get out of the way.
    lines.push("");
    lines.push(pad + tint(`${BOLD}JKY Terminal`) + DIM + ` v${version}` + RESET);
    lines.push("");
  } else {
    lines.push("");
    WORDMARK.forEach((row, i) => {
      const drawn = hasColour ? drawRow(row, i, WORDMARK.length, stops) : row;
      lines.push(pad + drawn + (hasColour ? RESET : ""));
    });
    lines.push("");

    // Tagline left, version right, both on one line. Right-aligning the
    // version against the pane width is what makes the block feel set rather
    // than merely printed.
    const versionLabel = `v${version}`;
    const spacer = Math.max(1, inner - TAGLINE.length - versionLabel.length);
    lines.push(
      pad + tint(TAGLINE) + " ".repeat(spacer) + DIM + versionLabel + RESET,
    );

    // A hairline the full width of the text block, sunk well back so it reads
    // as a division rather than as content.
    const ruleColour = hasColour ? hexToAnsi(shade(stops[0], 0.34)) : "";
    lines.push(pad + ruleColour + "─".repeat(inner) + (hasColour ? RESET : ""));

    lines.push(pad + DIM + HINTS + RESET);
    lines.push("");
  }

  return lines.map((line) => fitToWidth(line, cols)).join("\r\n") + `\r\n${RESET}\r\n`;
}
