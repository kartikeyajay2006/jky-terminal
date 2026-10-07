import { WORDMARK, isBevel, isFace } from "./glyph";
import { parseColor } from "./geometry";

/**
 * The closing wordmark: the app's own JKY grid, each of its cells split
 * into characters that fly in to assemble, flicker, and scatter from the
 * pointer before springing back — the page's opening idea, said once more
 * at the end.
 */

const SUB_X = 2;
const SUB_Y = 2;
const FACE = "@#$%&";
const BEVEL = ":=|+-";
const ASPECT = 1.8; // a glyph cell is this much taller than wide

interface Glyph {
  hx: number;
  hy: number;
  dx: number;
  dy: number;
  vx: number;
  vy: number;
  face: boolean;
  ch: string;
  col: number;
}

export function startFinale(canvas: HTMLCanvasElement, opts: { still: boolean }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const cols = WORDMARK[0].length * SUB_X;
  const rows = WORDMARK.length * SUB_Y;
  const glyphs: Glyph[] = [];
  const pick = (set: string) => set[Math.floor(Math.random() * set.length)];

  WORDMARK.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (!isFace(ch) && !isBevel(ch)) return;
      for (let sy = 0; sy < SUB_Y; sy++) {
        for (let sx = 0; sx < SUB_X; sx++) {
          // A bevel character is a thin line; one of its four cells is enough.
          if (isBevel(ch) && (sx + sy) % 2 === 1) continue;
          const col = c * SUB_X + sx;
          glyphs.push({ hx: col, hy: r * SUB_Y + sy, dx: 0, dy: 0, vx: 0, vy: 0, face: isFace(ch), ch: pick(isFace(ch) ? FACE : BEVEL), col });
        }
      }
    });
  });

  let palette: [number, number, number][] = [];
  const readColors = () => {
    const s = getComputedStyle(document.documentElement);
    palette = ["--accent", "--violet", "--magenta"].map((t) => parseColor(s.getPropertyValue(t)) ?? [1, 1, 1]);
  };
  const colorAt = (t: number) => {
    const [a, b, c] = palette;
    const lerp = (x: number[], y: number[], k: number) => x.map((v, i) => Math.round((v + (y[i] - v) * k) * 255));
    const rgb = t < 0.55 ? lerp(a, b, t / 0.55) : lerp(b, c, (t - 0.55) / 0.45);
    return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
  };

  let cell = 10;
  let dpr = 1;
  const size = () => {
    const w = canvas.clientWidth;
    dpr = Math.min(devicePixelRatio || 1, 2);
    cell = w / cols;
    canvas.style.height = `${Math.round(cell * ASPECT * rows)}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(cell * ASPECT * rows * dpr);
  };

  const pointer = { x: -1e4, y: -1e4, on: false };
  canvas.addEventListener("pointermove", (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = e.clientX - r.left;
    pointer.y = e.clientY - r.top;
    pointer.on = true;
  });
  canvas.addEventListener("pointerleave", () => (pointer.on = false));

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = `700 ${Math.round(cell * 1.5)}px "JetBrains Mono Variable", "JetBrains Mono", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const g of glyphs) {
      const x = (g.hx + 0.5) * cell + g.dx;
      const y = (g.hy + 0.5) * cell * ASPECT + g.dy;
      const stir = Math.min(1, Math.hypot(g.dx, g.dy) / (cell * 3));
      ctx.globalAlpha = g.face ? 1 : 0.42;
      ctx.fillStyle = colorAt(g.col / (cols - 1));
      ctx.shadowColor = ctx.fillStyle;
      ctx.shadowBlur = g.face ? cell * (0.6 + stir) : 0;
      ctx.fillText(g.ch, x, y);
    }
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 0;
  };

  readColors();
  size();
  window.addEventListener("jky:theme", () => {
    readColors();
    if (opts.still) draw();
  });
  new ResizeObserver(() => {
    size();
    draw();
  }).observe(canvas);

  if (opts.still) {
    draw();
    return;
  }

  // Assemble: every glyph starts scattered and springs home.
  let assembled = false;
  const scatter = () => {
    for (const g of glyphs) {
      const a = Math.random() * Math.PI * 2;
      const d = cell * (8 + Math.random() * 30);
      g.dx = Math.cos(a) * d;
      g.dy = Math.sin(a) * d;
    }
  };
  scatter();

  let visible = false;
  let raf = 0;
  const frame = () => {
    raf = 0;
    if (!visible) return;
    const R = cell * 9;
    for (const g of glyphs) {
      const hx = (g.hx + 0.5) * cell;
      const hy = (g.hy + 0.5) * cell * ASPECT;
      if (pointer.on) {
        const px = hx + g.dx - pointer.x;
        const py = hy + g.dy - pointer.y;
        const d = Math.hypot(px, py);
        if (d < R && d > 0.01) {
          const f = (1 - d / R) * cell * 0.9;
          g.vx += (px / d) * f;
          g.vy += (py / d) * f;
          if (Math.random() < 0.25) g.ch = pick(g.face ? FACE : BEVEL);
        }
      }
      // Spring home, with enough damping to settle without a wobble.
      g.vx = (g.vx - g.dx * 0.06) * 0.8;
      g.vy = (g.vy - g.dy * 0.06) * 0.8;
      g.dx += g.vx;
      g.dy += g.vy;
      if (Math.random() < 0.006) g.ch = pick(g.face ? FACE : BEVEL);
    }
    draw();
    raf = requestAnimationFrame(frame);
  };

  new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting;
      if (visible && !assembled) assembled = true;
      if (visible && !raf) raf = requestAnimationFrame(frame);
    },
    { threshold: 0.15 },
  ).observe(canvas);
}
