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

const ESC = "\u001b";
const RESET = `${ESC}[0m`;
const DIM = `${ESC}[2m`;

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

/** Sample a three-stop ramp at `t` in [0, 1]. */
function ramp(stops: Rgb[], t: number): Rgb {
  if (stops.length === 1) return stops[0];
  const scaled = Math.min(0.999, Math.max(0, t)) * (stops.length - 1);
  const i = Math.floor(scaled);
  return mix(stops[i], stops[i + 1], scaled - i);
}

/**
 * The JKY wordmark. Five rows of block characters, 22 columns wide.
 * Kept as data rather than generated, because a hand-set wordmark reads
 * better than anything an algorithm would produce at this size.
 */
const WORDMARK = [
  "    ██  ██  ██  ██  ██",
  "    ██  ██ ██    ████ ",
  "    ██  ████      ██  ",
  "██  ██  ██ ██     ██  ",
  " ████   ██  ██    ██  ",
];

const WORDMARK_WIDTH = 22;
const GUTTER = 2;

/**
 * Colour a line by horizontal position, so the gradient runs across the
 * wordmark rather than down it. Whitespace is emitted uncoloured to keep the
 * escape count down — a terminal redrawing this on every resize benefits.
 */
function gradientLine(line: string, stops: Rgb[], width: number): string {
  let out = "";
  let current = "";
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === " ") {
      out += ch;
      continue;
    }
    const colour = hexToAnsi(ramp(stops, i / Math.max(1, width - 1)));
    if (colour !== current) {
      out += colour;
      current = colour;
    }
    out += ch;
  }
  return out;
}

export function buildBanner({ cols, version, palette }: BannerOptions): string {
  const stops = [palette.accent, palette.violet, palette.magenta]
    .map(parseHex)
    .filter((c): c is Rgb => c !== null);

  const colour = (text: string) =>
    stops.length > 0 ? `${hexToAnsi(stops[0])}${text}${RESET}` : text;

  const lines: string[] = [];
  const compact = cols < WORDMARK_WIDTH + GUTTER * 2;

  if (compact) {
    // No room for the wordmark. Say who we are and get out of the way.
    lines.push("");
    lines.push(colour("JKY Terminal") + DIM + ` ${version}` + RESET);
    lines.push("");
  } else {
    const pad = " ".repeat(GUTTER);
    lines.push("");
    for (const row of WORDMARK) {
      const drawn =
        stops.length > 0 ? gradientLine(row, stops, WORDMARK_WIDTH) : row;
      lines.push(pad + drawn + (stops.length > 0 ? RESET : ""));
    }
    lines.push("");
    lines.push(
      pad +
        colour("JKY Terminal") +
        DIM +
        `  v${version}  ·  AI Terminal. Infinite Possibilities.` +
        RESET,
    );
    lines.push(
      pad + DIM + "Ctrl+T new terminal   Ctrl+W close   Ctrl+1-9 jump" + RESET,
    );
    lines.push("");
  }

  // Truncate on visible length, not raw length: an escape sequence occupies
  // no columns, so measuring the raw string would clip real characters.
  const fitted = lines.map((line) => fitToWidth(line, cols));

  return fitted.join("\r\n") + `\r\n${RESET}\r\n`;
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
