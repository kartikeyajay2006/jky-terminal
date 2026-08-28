/**
 * A character grid, the way a terminal draws.
 *
 * Every game here paints into one of these and hands the result to the DOM
 * once per frame. Two parallel flat arrays rather than an array of cell
 * objects: a 96×30 board is nearly three thousand cells redrawn sixty times a
 * second, and allocating three thousand objects per frame is how a game that
 * plays fine for ten seconds starts stuttering after a minute of garbage
 * collection.
 */

/**
 * What a cell is painted with.
 *
 * Names, not colours. Each resolves to a theme token in CSS, so the games
 * follow the seven themes for free and no component holds a literal hex —
 * which is a lint error in this codebase, and rightly so.
 */
export type Paint =
  | "bg"
  | "dim"
  | "muted"
  | "text"
  | "accent"
  | "accentDim"
  | "mint"
  | "warn"
  | "violet"
  | "magenta"
  | "danger";

const CLASS: Record<Paint, string> = {
  bg: "gp-bg",
  dim: "gp-dim",
  muted: "gp-muted",
  text: "gp-text",
  accent: "gp-accent",
  accentDim: "gp-accent-dim",
  mint: "gp-mint",
  warn: "gp-warn",
  violet: "gp-violet",
  magenta: "gp-magenta",
  danger: "gp-danger",
};

/** The one character a sprite treats as "leave what is underneath alone". */
export const TRANSPARENT = " ";

function escapeHtml(s: string): string {
  // Only three characters can break out of text content, and the games paint
  // box-drawing and block glyphs that must survive untouched.
  let out = "";
  for (const ch of s) {
    out += ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch;
  }
  return out;
}

export class Grid {
  readonly cols: number;
  readonly rows: number;
  private readonly chars: string[];
  private readonly paints: Paint[];

  constructor(cols: number, rows: number) {
    this.cols = Math.max(1, Math.floor(cols));
    this.rows = Math.max(1, Math.floor(rows));
    const size = this.cols * this.rows;
    this.chars = new Array<string>(size).fill(" ");
    this.paints = new Array<Paint>(size).fill("bg");
  }

  /** Wipe the board back to one character and one paint. */
  clear(ch = " ", paint: Paint = "bg"): void {
    this.chars.fill(ch);
    this.paints.fill(paint);
  }

  /** Is this coordinate on the board at all? */
  inside(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.cols && y < this.rows;
  }

  set(x: number, y: number, ch: string, paint: Paint): void {
    const cx = Math.round(x);
    const cy = Math.round(y);
    if (!this.inside(cx, cy)) return;
    const i = cy * this.cols + cx;
    this.chars[i] = ch;
    this.paints[i] = paint;
  }

  /** What is painted at a coordinate, or a space when off the board. */
  charAt(x: number, y: number): string {
    const cx = Math.round(x);
    const cy = Math.round(y);
    return this.inside(cx, cy) ? this.chars[cy * this.cols + cx] : " ";
  }

  /** One string, left to right. Characters off the edge are dropped. */
  text(x: number, y: number, str: string, paint: Paint): void {
    let cx = Math.round(x);
    for (const ch of str) {
      this.set(cx, y, ch, paint);
      cx += 1;
    }
  }

  /** Centre a string across the whole width. */
  centre(y: number, str: string, paint: Paint): void {
    this.text(Math.floor((this.cols - [...str].length) / 2), y, str, paint);
  }

  /**
   * Centre a string with clear space either side of it.
   *
   * Overlay text written straight onto a busy board butts up against
   * whatever is behind it — on Snake's dot lattice the title read as though
   * it had been dropped into the middle of the dots rather than laid over
   * them. Padding with spaces clears the cells, because unlike a sprite's
   * spaces, a written space is opaque.
   */
  banner(y: number, str: string, paint: Paint, pad = 2): void {
    const spaces = " ".repeat(Math.max(0, pad));
    this.centre(y, `${spaces}${str}${spaces}`, paint);
  }

  hLine(x: number, y: number, len: number, ch: string, paint: Paint): void {
    for (let i = 0; i < len; i += 1) this.set(x + i, y, ch, paint);
  }

  vLine(x: number, y: number, len: number, ch: string, paint: Paint): void {
    for (let i = 0; i < len; i += 1) this.set(x, y + i, ch, paint);
  }

  /**
   * Paint a multi-line sprite, leaving the background showing through spaces.
   *
   * That transparency is the whole reason sprites are not just repeated
   * `text` calls: a dino drawn as solid rows would carry a rectangle of
   * blank sky with it and scrub out the ground it is standing on.
   */
  sprite(x: number, y: number, lines: readonly string[], paint: Paint): void {
    for (let row = 0; row < lines.length; row += 1) {
      const line = lines[row];
      let col = 0;
      for (const ch of line) {
        if (ch !== TRANSPARENT) this.set(x + col, y + row, ch, paint);
        col += 1;
      }
    }
  }

  /** A box in light box-drawing characters, corners included. */
  box(x: number, y: number, w: number, h: number, paint: Paint): void {
    if (w < 2 || h < 2) return;
    this.hLine(x + 1, y, w - 2, "─", paint);
    this.hLine(x + 1, y + h - 1, w - 2, "─", paint);
    this.vLine(x, y + 1, h - 2, "│", paint);
    this.vLine(x + w - 1, y + 1, h - 2, "│", paint);
    this.set(x, y, "┌", paint);
    this.set(x + w - 1, y, "┐", paint);
    this.set(x, y + h - 1, "└", paint);
    this.set(x + w - 1, y + h - 1, "┘", paint);
  }

  /** Fill a rectangle with one character. */
  fill(x: number, y: number, w: number, h: number, ch: string, paint: Paint): void {
    for (let row = 0; row < h; row += 1) {
      this.hLine(x, y + row, w, ch, paint);
    }
  }

  /**
   * The board as HTML, one span per run of same-painted characters.
   *
   * A span per cell would be three thousand elements a frame, which no
   * browser lays out at sixty. Runs collapse a sky of identical blanks into
   * one node, and a typical frame here emits well under two hundred.
   */
  toHtml(): string {
    let out = "";
    for (let y = 0; y < this.rows; y += 1) {
      const base = y * this.cols;
      let runPaint = this.paints[base];
      let run = "";
      for (let x = 0; x < this.cols; x += 1) {
        const i = base + x;
        const paint = this.paints[i];
        if (paint !== runPaint) {
          out += `<span class="${CLASS[runPaint]}">${escapeHtml(run)}</span>`;
          run = "";
          runPaint = paint;
        }
        run += this.chars[i];
      }
      out += `<span class="${CLASS[runPaint]}">${escapeHtml(run)}</span>`;
      if (y < this.rows - 1) out += "\n";
    }
    return out;
  }

  /** The board as plain text, for tests that care about shape not colour. */
  toText(): string {
    const lines: string[] = [];
    for (let y = 0; y < this.rows; y += 1) {
      lines.push(this.chars.slice(y * this.cols, y * this.cols + this.cols).join(""));
    }
    return lines.join("\n");
  }
}
