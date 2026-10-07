import type { APIRoute } from "astro";
import { themeTokens } from "../lib/facts";
import { JKY_GLYPH } from "../lib/glyph";

/**
 * The favicon, drawn at build time from the app's glyph and the default
 * theme's tokens — so even the 16-pixel square carries no colour typed in by
 * hand. A browser tab cannot read CSS variables, which is why it is baked.
 */
export const GET: APIRoute = () => {
  const t = themeTokens().cyberpunk;
  const { chevron, hook, spark, stroke } = JKY_GLYPH;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`,
    `<defs><linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0" stop-color="${t["--accent"]}"/>`,
    `<stop offset=".55" stop-color="${t["--violet"]}"/>`,
    `<stop offset="1" stop-color="${t["--magenta"]}"/>`,
    `</linearGradient></defs>`,
    `<rect width="64" height="64" rx="16" fill="${t["--ground"]}"/>`,
    `<rect x="3" y="3" width="58" height="58" rx="14" fill="none" stroke="url(#g)" stroke-width="2.5" opacity=".75"/>`,
    `<g fill="none" stroke="url(#g)" stroke-width="${stroke + 0.5}" stroke-linecap="round" stroke-linejoin="round">`,
    `<path d="${chevron}"/><path d="${hook}"/></g>`,
    `<circle cx="${spark.cx}" cy="${spark.cy}" r="${spark.r + 0.5}" fill="${t["--accent"]}"/>`,
    `</svg>`,
  ].join("");
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml" } });
};
