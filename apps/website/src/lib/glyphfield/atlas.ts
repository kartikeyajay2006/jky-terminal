/**
 * The glyph atlas: every character the field can draw, rendered once in the
 * site's own JetBrains Mono, white on black, into a grid the shader samples.
 *
 * The ramp is sorted by measured ink — each glyph is drawn and its pixels
 * counted — rather than by a hand-ordered string, so "denser" means denser in
 * this font, at this weight, on this machine.
 */

/**
 * Candidates for the brightness ramp. Symbols only: a letter in a texture is
 * read as a word, and the field should read as light, not as text. Letters
 * appear only in the scramble, where reading them is the point.
 */
const RAMP_CANDIDATES = " .`',:;-~_^\"+=<>!?*|/\\()[]{}%&$#@";

/** What a cell flickers through while it boots or is stirred. */
const SCRAMBLE = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789$#%&*+=<>/\\|{}[]?!~^";

export const ATLAS_COLUMNS = 16;
const CELL_W = 28;
const CELL_H = 48;
const RAMP_SIZE = 22;

export interface Atlas {
  canvas: HTMLCanvasElement;
  columns: number;
  rows: number;
  ramp: number;
  scramble: number;
}

export function buildAtlas(fontFamily: string): Atlas {
  const font = `600 ${Math.round(CELL_H * 0.72)}px ${fontFamily}`;

  // Measure each candidate's ink on a scratch canvas.
  const probe = document.createElement("canvas");
  probe.width = CELL_W;
  probe.height = CELL_H;
  const pc = probe.getContext("2d", { willReadFrequently: true });
  if (!pc) throw new Error("no 2d context");
  const draw = (ctx: CanvasRenderingContext2D, ch: string, x: number, y: number) => {
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "white";
    ctx.fillText(ch, x + CELL_W / 2, y + CELL_H / 2 + 1);
  };
  const inkOf = (ch: string) => {
    pc.clearRect(0, 0, CELL_W, CELL_H);
    draw(pc, ch, 0, 0);
    const data = pc.getImageData(0, 0, CELL_W, CELL_H).data;
    let sum = 0;
    for (let i = 3; i < data.length; i += 4) sum += data[i];
    return sum;
  };

  const measured = [...new Set(RAMP_CANDIDATES)].map((ch) => ({ ch, ink: inkOf(ch) })).sort((a, b) => a.ink - b.ink);

  // Keep the space, then pick glyphs spread evenly across the ink range so
  // each step up the ramp is a visible step.
  const max = measured[measured.length - 1].ink;
  const ramp = [" "];
  for (let k = 1; k < RAMP_SIZE; k++) {
    const target = (k / (RAMP_SIZE - 1)) * max;
    let best = measured[1];
    for (const m of measured) if (Math.abs(m.ink - target) < Math.abs(best.ink - target)) best = m;
    if (!ramp.includes(best.ch)) ramp.push(best.ch);
  }

  const glyphs = [...ramp, ...SCRAMBLE];
  const rows = Math.ceil(glyphs.length / ATLAS_COLUMNS);
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_COLUMNS * CELL_W;
  canvas.height = rows * CELL_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  glyphs.forEach((ch, i) => draw(ctx, ch, (i % ATLAS_COLUMNS) * CELL_W, Math.floor(i / ATLAS_COLUMNS) * CELL_H));

  return { canvas, columns: ATLAS_COLUMNS, rows, ramp: ramp.length, scramble: SCRAMBLE.length };
}
