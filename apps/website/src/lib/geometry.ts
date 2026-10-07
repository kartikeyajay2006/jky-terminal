/**
 * Small, pure geometry and colour helpers for the glyph field — kept apart
 * from the WebGL code so they can be tested without a GPU.
 */

/** A line segment, as [ax, ay, bx, by]. */
export type Segment = [number, number, number, number];

/**
 * Flattens an SVG path made of M, L and Q commands — all the JKY glyph uses —
 * into straight segments. A quadratic curve becomes `steps` segments along
 * it, which at the field's resolution is indistinguishable from the curve.
 *
 * The shader measures distance to these segments, so the mark it draws is the
 * app's mark: the coordinates come from jkyGlyph.ts, not from a copy.
 */
export function flattenPath(d: string, steps = 6): Segment[] {
  // Every letter is a token, so a command this does not draw is refused
  // rather than its numbers being read as more of the previous one.
  const tokens = d.match(/[a-z]|-?\d*\.?\d+(?:e-?\d+)?/gi) ?? [];
  const out: Segment[] = [];
  let i = 0;
  let cmd = "";
  let x = 0;
  let y = 0;
  const num = () => {
    const t = tokens[i++];
    if (t === undefined || /[a-z]/i.test(t)) throw new Error(`path ended early: ${d}`);
    return parseFloat(t);
  };

  while (i < tokens.length) {
    if (/^[a-z]$/i.test(tokens[i])) cmd = tokens[i++].toUpperCase();
    if (cmd === "M") {
      x = num();
      y = num();
      cmd = "L"; // further pairs after a move are lines, as in SVG
    } else if (cmd === "L") {
      const nx = num();
      const ny = num();
      out.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    } else if (cmd === "Q") {
      const qx = num();
      const qy = num();
      const ex = num();
      const ey = num();
      let px = x;
      let py = y;
      for (let k = 1; k <= steps; k++) {
        const t = k / steps;
        const ax = x + (qx - x) * t;
        const ay = y + (qy - y) * t;
        const bx = qx + (ex - qx) * t;
        const by = qy + (ey - qy) * t;
        const cx = ax + (bx - ax) * t;
        const cy = ay + (by - ay) * t;
        out.push([px, py, cx, cy]);
        px = cx;
        py = cy;
      }
      x = ex;
      y = ey;
    } else {
      throw new Error(`unsupported path command in ${d}`);
    }
  }
  return out;
}

/**
 * A CSS colour as linear [r, g, b] in 0..1 — from `#rgb`, `#rrggbb` or
 * `rgb()`/`rgba()`, which is everything a theme token holds. Returns null
 * for anything else rather than inventing a colour.
 */
export function parseColor(value: string): [number, number, number] | null {
  const v = value.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v);
  if (short) return [short[1], short[2], short[3]].map((h) => parseInt(h + h, 16) / 255) as [number, number, number];
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})(?:[0-9a-f]{2})?$/i.exec(v);
  if (long) return [long[1], long[2], long[3]].map((h) => parseInt(h, 16) / 255) as [number, number, number];
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
  if (fn) return [fn[1], fn[2], fn[3]].map((n) => Math.min(255, parseFloat(n)) / 255) as [number, number, number];
  return null;
}
