import { JKY_GLYPH } from "../glyph";
import { flattenPath, parseColor } from "../geometry";
import { buildAtlas } from "./atlas";
import { FRAGMENT, MAX_SEGMENTS, VERTEX } from "./shaders";

/**
 * Runs the glyph field on a canvas: the app's emblem drawn in characters,
 * turning, lit by the theme, stirred by the pointer.
 *
 * Returns null when the field cannot run — no WebGL2, a shader the driver
 * refuses — and the page keeps its SVG emblem, which is the same drawing.
 */

export interface FieldOptions {
  /** The element whose box the emblem fills; the SVG emblem, so they align. */
  emblem: HTMLElement;
  /** Where pointer movement is listened for. */
  surface: HTMLElement;
  /** Draw one finished frame and never animate. */
  still: boolean;
}

export interface Field {
  stop(): void;
}

const FONT = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

export async function startGlyphField(canvas: HTMLCanvasElement, opts: FieldOptions): Promise<Field | null> {
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "high-performance",
  });
  if (!gl) return null;

  const program = await link(gl, VERTEX, FRAGMENT);
  if (!program) return null;

  // The atlas needs the real font, or it bakes a fallback face forever.
  try {
    await document.fonts.load(`600 34px ${FONT}`);
  } catch {
    /* draw with whatever loaded */
  }
  const atlas = buildAtlas(FONT);

  gl.useProgram(program);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const u = (name: string) => gl.getUniformLocation(program, name);
  const loc = {
    res: u("uRes"),
    dpr: u("uDpr"),
    cell: u("uCell"),
    time: u("uTime"),
    boot: u("uBoot"),
    emblem: u("uEmblem"),
    pointer: u("uPointer"),
    ripple: u("uRipple"),
    accent: u("uAccent"),
    violet: u("uViolet"),
    magenta: u("uMagenta"),
    dim: u("uDim"),
    ambient: u("uAmbient"),
    quiet: u("uQuiet"),
    hushY: u("uHushY"),
    fade: u("uFade"),
    bloom: u("uBloom"),
    atlas: u("uAtlas"),
    atlasGrid: u("uAtlasGrid"),
    ramp: u("uRamp"),
    scramble: u("uScramble"),
    seg: u("uSeg"),
    segs: u("uSegs"),
    spark: u("uSpark"),
    stroke: u("uStroke"),
  };

  // The mark's strokes, straight from the app's geometry.
  const segments = [...flattenPath(JKY_GLYPH.chevron), ...flattenPath(JKY_GLYPH.hook, 6)].slice(0, MAX_SEGMENTS);
  gl.uniform4fv(loc.seg, new Float32Array(segments.flat()));
  gl.uniform1i(loc.segs, segments.length);
  gl.uniform3f(loc.spark, JKY_GLYPH.spark.cx, JKY_GLYPH.spark.cy, JKY_GLYPH.spark.r);
  gl.uniform1f(loc.stroke, JKY_GLYPH.stroke);
  gl.uniform1i(loc.atlas, 0);
  gl.uniform2f(loc.atlasGrid, atlas.columns, atlas.rows);
  gl.uniform1f(loc.ramp, atlas.ramp);
  gl.uniform1f(loc.scramble, atlas.scramble);

  // Colours are the live theme's tokens, re-read whenever the theme changes.
  const readTheme = () => {
    const style = getComputedStyle(document.documentElement);
    const set = (where: WebGLUniformLocation | null, token: string) => {
      const rgb = parseColor(style.getPropertyValue(token));
      if (rgb) gl.uniform3f(where, rgb[0], rgb[1], rgb[2]);
    };
    set(loc.accent, "--accent");
    set(loc.violet, "--violet");
    set(loc.magenta, "--magenta");
    set(loc.dim, "--text-dim");
    // Glow reads as light on a dark ground and as smudge on a light one.
    const ground = parseColor(style.getPropertyValue("--ground"));
    const lightGround = ground ? ground[0] * 0.2126 + ground[1] * 0.7152 + ground[2] * 0.0722 > 0.5 : false;
    gl.uniform1f(loc.bloom, lightGround ? 0.25 : 1);
    draw();
  };

  // Layout: canvas size, cell size, and where the emblem sits.
  let dprCap = Math.min(window.devicePixelRatio || 1, 2);
  let cssW = 1;
  let cssH = 1;
  let narrow = false;
  const layout = () => {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    narrow = cssW <= 900;
    const dpr = dprCap;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(loc.res, canvas.width, canvas.height);
    gl.uniform1f(loc.dpr, canvas.width / cssW);
    gl.uniform2f(loc.cell, narrow ? 7 : 8, narrow ? 12 : 14);
    const e = opts.emblem.getBoundingClientRect();
    gl.uniform3f(loc.emblem, e.left - rect.left, e.top - rect.top, e.width);
    gl.uniform1f(loc.ambient, narrow ? 0.7 : 1);
    // Wide: the words are to the left, so hush the left. Narrow: the words
    // are below the emblem, so hush everything under it.
    gl.uniform1f(loc.quiet, narrow ? 0 : 1);
    gl.uniform1f(loc.hushY, narrow ? e.bottom - rect.top : 0);
    draw();
  };

  // Pointer, eased so the lens glides rather than jumps.
  const pointer = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, s: 0, ts: 0 };
  const onMove = (ev: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    pointer.tx = ev.clientX - rect.left;
    pointer.ty = ev.clientY - rect.top;
    if (pointer.s < 0.01) {
      pointer.x = pointer.tx;
      pointer.y = pointer.ty;
    }
    pointer.ts = 1;
  };
  const onLeave = () => {
    pointer.ts = 0;
  };
  let ripple = { x: 0, y: 0, t: -10 };
  const onDown = (ev: PointerEvent) => {
    if ((ev.target as Element | null)?.closest("a, button, input, code, [data-terminal]")) return;
    const rect = canvas.getBoundingClientRect();
    ripple = { x: ev.clientX - rect.left, y: ev.clientY - rect.top, t: clock };
  };

  // The clock: real time while visible, frozen while not, standing still
  // altogether under reduced motion.
  const start = performance.now();
  let clock = 0;
  let boot = opts.still ? 10 : 0;
  let last = start;
  let visible = true;
  let raf = 0;
  let frames = 0;
  let slow = 0;

  // Counted, so a test can prove that asked for less motion, it stops at one.
  let draws = 0;
  const draw = () => {
    (canvas as HTMLCanvasElement & { jkyDraws?: number }).jkyDraws = ++draws;
    gl.uniform1f(loc.time, clock);
    gl.uniform1f(loc.boot, boot);
    gl.uniform4f(loc.pointer, pointer.x, pointer.y, pointer.s, narrow ? 80 : 105);
    gl.uniform4f(loc.ripple, ripple.x, ripple.y, ripple.t, 1);
    const scroll = Math.min(1, Math.max(0, window.scrollY / Math.max(1, cssH)));
    gl.uniform1f(loc.fade, 1 - scroll * 0.75);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  const tick = (now: number) => {
    raf = 0;
    if (!visible || document.hidden) return;
    // Capped, so a tab returning from the background resumes rather than
    // leaps; generous enough that a slow machine still finishes the boot.
    const dt = Math.min(0.2, (now - last) / 1000);
    last = now;
    clock += dt;
    boot += dt;
    pointer.x += (pointer.tx - pointer.x) * Math.min(1, dt * 9);
    pointer.y += (pointer.ty - pointer.y) * Math.min(1, dt * 9);
    pointer.s += (pointer.ts - pointer.s) * Math.min(1, dt * 5);
    draw();

    // A machine that cannot keep up gets fewer pixels, not a stutter.
    if (frames < 120) {
      frames++;
      if (dt > 0.024) slow++;
      if (frames === 120 && slow > 50 && dprCap > 1) {
        dprCap = 1;
        layout();
      }
    }
    raf = requestAnimationFrame(tick);
  };

  const run = () => {
    if (opts.still || raf || !visible || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  const io = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    run();
  });
  io.observe(canvas);
  const ro = new ResizeObserver(() => layout());
  ro.observe(canvas);
  const mo = new MutationObserver(readTheme);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const onVisibility = () => run();
  document.addEventListener("visibilitychange", onVisibility);
  const onScroll = () => {
    if (opts.still) draw();
  };
  window.addEventListener("scroll", onScroll, { passive: true });
  if (!opts.still) {
    opts.surface.addEventListener("pointermove", onMove);
    opts.surface.addEventListener("pointerleave", onLeave);
    opts.surface.addEventListener("pointerdown", onDown);
  }
  canvas.addEventListener("webglcontextlost", () => stop());

  layout();
  readTheme();
  run();

  const stop = () => {
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    mo.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("scroll", onScroll);
    opts.surface.removeEventListener("pointermove", onMove);
    opts.surface.removeEventListener("pointerleave", onLeave);
    opts.surface.removeEventListener("pointerdown", onDown);
  };
  return { stop };
}

/**
 * Compiles and links without freezing the page.
 *
 * Asking whether a shader compiled forces the driver to finish compiling it
 * then and there, on the main thread — on a slow GPU, long enough to drop
 * scroll frames. Where the browser offers KHR_parallel_shader_compile, the
 * build runs in the background and is only asked about once it says it is
 * done.
 */
async function link(gl: WebGL2RenderingContext, vs: string, fs: string): Promise<WebGLProgram | null> {
  const make = (type: number, src: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    return shader;
  };
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  const program = gl.createProgram();
  if (!v || !f || !program) return null;
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);

  const parallel = gl.getExtension("KHR_parallel_shader_compile") as { COMPLETION_STATUS_KHR: number } | null;
  if (parallel) {
    while (!gl.getProgramParameter(program, parallel.COMPLETION_STATUS_KHR)) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    for (const s of [v, f]) {
      const log = gl.getShaderInfoLog(s);
      if (log) console.warn("glyph field: shader did not compile —", log);
    }
    console.warn("glyph field: program did not link —", gl.getProgramInfoLog(program));
    return null;
  }
  return program;
}
