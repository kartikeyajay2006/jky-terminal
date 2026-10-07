/*
 * The glyph field's shaders.
 *
 * The screen is a grid of character cells, as in a terminal. Every cell asks
 * one question — how much light falls here? — and answers with a glyph from a
 * ramp of characters sorted by how much ink they use: a space for none, a dot
 * for a little, `@` for all of it.
 *
 * The light is the app's emblem, worked out per cell rather than drawn: the
 * tick ring, the radar sweep, the track and its two arcs, three orbiting
 * nodes, and the mark itself — each at the radius, dash length and speed it
 * has in components/emblemSvg.ts, so the emblem made of characters turns
 * exactly like the one made of vectors. The mark is a distance field over its
 * real strokes (flattened from jkyGlyph.ts), which lets the cells along an
 * edge take lighter glyphs than the cells inside it: anti-aliasing, in ASCII.
 */

export const VERTEX = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const MAX_SEGMENTS = 16;

export const FRAGMENT = /* glsl */ `#version 300 es
precision highp float;

uniform vec2 uRes;        // drawing buffer, device px
uniform float uDpr;       // device px per CSS px
uniform vec2 uCell;       // one character cell, CSS px
uniform float uTime;      // seconds; stands still under reduced motion
uniform float uBoot;      // seconds since the field first drew
uniform vec3 uEmblem;     // the emblem's box: left, top, size, CSS px
uniform vec4 uPointer;    // x, y (CSS px), strength 0..1, radius (CSS px)
uniform vec4 uRipple;     // x, y (CSS px), start time, 0..1 on
uniform vec3 uAccent;
uniform vec3 uViolet;
uniform vec3 uMagenta;
uniform vec3 uDim;
uniform float uAmbient;   // how much of the background field shows
uniform float uQuiet;     // 0..1, how far to hush the field under the words on the left
uniform float uHushY;     // CSS px below which the field fades out; 0 for never
uniform float uFade;      // the whole field's opacity
uniform float uBloom;     // glow around the mark: full on a dark ground, faint on a light one
uniform sampler2D uAtlas; // white glyphs on black, uAtlasGrid cells
uniform vec2 uAtlasGrid;
uniform float uRamp;      // ramp glyphs at the start of the atlas, sparse to dense
uniform float uScramble;  // scramble glyphs after them
uniform vec4 uSeg[${MAX_SEGMENTS}];   // the mark's strokes, in its 64-unit space
uniform int uSegs;
uniform vec3 uSpark;      // the mark's cursor: cx, cy, r
uniform float uStroke;    // the mark's stroke width

out vec4 outColor;

const float PI = 3.14159265;
const float TAU = 6.28318531;
const float ARC_LEN = 276.460154; // 2 * PI * 44, as in emblemSvg.ts

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = hash13(i);
  float b = hash13(i + vec3(1.0, 0.0, 0.0));
  float c = hash13(i + vec3(0.0, 1.0, 0.0));
  float d = hash13(i + vec3(1.0, 1.0, 0.0));
  float e = hash13(i + vec3(0.0, 0.0, 1.0));
  float f1 = hash13(i + vec3(1.0, 0.0, 1.0));
  float g = hash13(i + vec3(0.0, 1.0, 1.0));
  float h = hash13(i + vec3(1.0, 1.0, 1.0));
  return mix(mix(mix(a, b, u.x), mix(c, d, u.x), u.y), mix(mix(e, f1, u.x), mix(g, h, u.x), u.y), u.z);
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// A ring of the given radius and stroke width, at least one cell wide so a
// hairline still lands on the grid.
float ring(float r, float radius, float width, float cellU) {
  float d = abs(r - radius);
  return 1.0 - smoothstep(width * 0.5, width * 0.5 + cellU, d);
}

// The emblem's light: the app's accent through violet to magenta, along the
// same diagonal its SVG gradient runs (0,0) to (120,120).
vec3 gradient(vec2 e) {
  float g = clamp((e.x + e.y) / 240.0, 0.0, 1.0);
  vec3 c = mix(uAccent, uViolet, smoothstep(0.0, 0.55, g));
  return mix(c, uMagenta, smoothstep(0.55, 1.0, g));
}

void main() {
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uDpr;
  vec2 cell = floor(px / uCell);
  vec2 local = fract(px / uCell);
  vec2 centre = (cell + 0.5) * uCell;
  float h = hash12(cell);

  // Where this cell sits in the emblem's own 120-unit space.
  float unit = uEmblem.z / 120.0;
  vec2 e = (centre - uEmblem.xy) / unit;
  vec2 d = e - 60.0;
  float r = length(d);
  float a = atan(d.y, d.x); // clockwise from three o'clock, as y runs down
  float cellU = 0.5 * length(uCell) / unit;

  // Tick ring, r 54, 1.1-on 4.55-off, a turn every 48 s.
  float aTick = a - TAU * uTime / 48.0;
  float tick = 0.5 + 0.5 * cos(TAU * aTick * 54.0 / 5.65);
  float ticks = ring(r, 54.0, 1.6, cellU) * smoothstep(0.4, 0.95, tick) * 0.72;

  // The sweep: a 45-degree wedge inside r 52, leading edge brightest, fading
  // behind it like a radar's. Lights the field rather than painting a shape.
  float lead = -0.25 * PI + TAU * uTime / 6.0;
  float lag = mod(lead - a, TAU);
  float sweep = exp(-lag * 2.4) * (1.0 - smoothstep(48.0, 53.0, r)) * smoothstep(3.0, 10.0, r);

  // The track and its two arcs, turning the other way every 9 s.
  float track = ring(r, 44.0, 2.4, cellU) * 0.3;
  float s1 = mod(a + TAU * uTime / 9.0, TAU) * 44.0;
  float arc1 = smoothstep(0.0, 3.0, s1) * (1.0 - smoothstep(89.0, 92.0, s1));
  float s2 = mod(s1 - ARC_LEN * 0.5, ARC_LEN);
  float arc2 = smoothstep(0.0, 3.0, s2) * (1.0 - smoothstep(17.0, 20.0, s2));
  float arcs = max(arc1, arc2) * ring(r, 44.0, 2.6, cellU);

  // Three nodes a third of a turn apart on r 36, a turn every 16 s.
  float th = TAU * uTime / 16.0;
  vec2 n1 = 60.0 + 36.0 * vec2(cos(-0.5 * PI + th), sin(-0.5 * PI + th));
  vec2 n2 = 60.0 + 36.0 * vec2(cos(PI / 6.0 + th), sin(PI / 6.0 + th));
  vec2 n3 = 60.0 + 36.0 * vec2(cos(5.0 * PI / 6.0 + th), sin(5.0 * PI / 6.0 + th));
  float o1 = 1.0 - smoothstep(3.0, 3.0 + cellU, length(e - n1));
  float o2 = 1.0 - smoothstep(2.6, 2.6 + cellU, length(e - n2));
  float o3 = 1.0 - smoothstep(2.6, 2.6 + cellU, length(e - n3));

  // The mark, placed as the emblem places it: translate(32.8 35.8) scale(.85).
  vec2 q = (e - vec2(32.8, 35.8)) / 0.85;
  float qCell = cellU / 0.85;
  float dm = 1e9;
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uSegs) break;
    dm = min(dm, sdSeg(q, uSeg[i].xy, uSeg[i].zw));
  }
  // Drawn a third heavier than the vector mark: at the size of a character
  // cell, the app's stroke is two cells wide, and the mark is the hero here.
  float half_ = uStroke * 0.5 * 1.35;
  float mark = 1.0 - smoothstep(half_ - qCell * 0.35, half_ + qCell * 0.7, dm);
  float markGlow = (1.0 - smoothstep(half_, half_ + qCell * 3.2, dm)) * 0.3;
  float spark = 1.0 - smoothstep(uSpark.z * 1.3 - qCell * 0.3, uSpark.z * 1.3 + qCell * 0.7, length(q - uSpark.xy));
  spark *= 0.55 + 0.45 * (0.5 + 0.5 * sin(TAU * uTime / 1.4));

  // Pick the brightest part this cell belongs to, and its colour.
  vec3 grad = gradient(e);
  float part = max(max(ticks, track), max(arcs, max(mark, markGlow)));
  vec3 partCol = grad;
  if (o1 > part) { part = o1; partCol = uAccent; }
  if (o2 > part) { part = o2; partCol = uViolet; }
  if (o3 > part) { part = o3; partCol = uMagenta; }
  if (spark > part) { part = spark; partCol = uAccent; }

  // The quiet field behind everything: slow noise, denser near the emblem,
  // hushed on the left where the words are.
  float n = vnoise(vec3(cell * vec2(0.075, 0.13), uTime * 0.07)) * 0.7
          + vnoise(vec3(cell * vec2(0.19, 0.33), uTime * 0.11 + 9.0)) * 0.3;
  float width = uRes.x / uDpr;
  float hush = mix(1.0, smoothstep(0.16, 0.62, px.x / width), uQuiet);
  if (uHushY > 0.0) hush *= 1.0 - smoothstep(uHushY - 80.0, uHushY + 40.0, px.y);
  // Near the emblem the field grows denser — more cells cross the threshold —
  // rather than brighter everywhere at once, which only paints stripes.
  float halo = 1.0 - smoothstep(14.0, 72.0, r);
  float amb = smoothstep(0.5 - halo * 0.22, 0.95, n) * (0.38 * uAmbient + halo * 0.2) * hush;

  // Pointer: a lens that lights and stirs the cells under it.
  float pd = length(centre - uPointer.xy);
  float pf = exp(-(pd * pd) / (uPointer.w * uPointer.w)) * uPointer.z;

  // A click sends a ring of stirred cells outward.
  float rt = uTime - uRipple.z;
  float rr = rt * 820.0;
  float rd = abs(length(centre - uRipple.xy) - rr);
  float ripple = (1.0 - smoothstep(0.0, 46.0, rd)) * (1.0 - smoothstep(0.2, 1.3, rt)) * step(0.0, rt) * uRipple.w;

  // Boot: the emblem assembles from its centre outward, the field after it,
  // every cell flickering through random characters before it settles.
  float delayPart = 0.2 + (r / 120.0) * 0.8 + h * 0.35;
  float delayAmb = 0.35 + h * 1.5;
  float partIn = smoothstep(delayPart, delayPart + 0.3, uBoot);
  float ambIn = smoothstep(delayAmb, delayAmb + 0.6, uBoot);

  float iPart = part * partIn;
  float iAmb = (amb + sweep * 0.5 * hush) * ambIn;
  float intensity = max(iPart, iAmb) + pf * 0.34 + ripple * 0.6;

  // The pointer stirs the field but only lights the emblem: the mark under
  // your cursor should get brighter, not turn into noise.
  bool booting = uBoot < delayPart + 0.55 && part > 0.08;
  bool stirred = (pf > 0.28 || ripple > 0.25) && part < 0.25 && hash12(cell + floor(uTime * 14.0)) > 0.45;
  bool flicker = hash12(cell + floor(uTime * 2.5) * 7.13) > 0.9978 && intensity > 0.12;

  float idx;
  if (booting || stirred || flicker) {
    idx = uRamp + floor(hash12(cell * 1.7 + floor(uTime * 18.0) * 3.31) * uScramble);
  } else {
    idx = floor(clamp(intensity, 0.0, 1.0) * (uRamp - 1.0) + 0.5);
  }

  vec2 at = vec2(mod(idx, uAtlasGrid.x), floor(idx / uAtlasGrid.x));
  float ink = texture(uAtlas, (at + clamp(local, 0.03, 0.97)) / uAtlasGrid).r;

  float wPart = iPart / max(iPart + iAmb, 1e-4);
  vec3 ambCol = mix(uDim, uAccent, clamp(sweep * 1.1 + pf, 0.0, 1.0));
  vec3 col = mix(ambCol, partCol, wPart);
  col = mix(col, uAccent, clamp(pf * 0.4 + ripple * 0.5, 0.0, 1.0));

  float alpha = ink * clamp(intensity * 1.3, 0.0, 1.0);
  alpha *= mix(0.5, 1.0, max(wPart, max(pf, ripple)));

  // Bloom: light spilling from the mark and the arcs onto the ground between
  // the glyphs, measured per pixel so it is smooth rather than cell-shaped.
  // It is what makes the characters read as lit rather than printed.
  vec2 qp = ((px - uEmblem.xy) / unit - vec2(32.8, 35.8)) / 0.85;
  float dp = 1e9;
  for (int i = 0; i < ${MAX_SEGMENTS}; i++) {
    if (i >= uSegs) break;
    dp = min(dp, sdSeg(qp, uSeg[i].xy, uSeg[i].zw));
  }
  dp = min(dp, length(qp - uSpark.xy) - uSpark.z);
  float rp = length((px - uEmblem.xy) / unit - 60.0);
  float glow = exp(-max(dp - half_, 0.0) / 5.0) * 0.16 * partIn
             + exp(-abs(rp - 44.0) / 2.5) * arcs * 0.08;
  vec3 glowCol = gradient((px - uEmblem.xy) / unit);
  float g = glow * uBloom;

  // Glyph over glow, both premultiplied.
  vec3 rgb = col * alpha + glowCol * g * (1.0 - alpha);
  float coverage = alpha + g * (1.0 - alpha);
  outColor = vec4(rgb, coverage) * uFade;
}
`;
