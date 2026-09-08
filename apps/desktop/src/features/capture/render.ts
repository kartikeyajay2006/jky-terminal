/**
 * Turning the window into a picture of itself.
 *
 * There is no portable way to ask an operating system for a photograph of a
 * Tauri webview — the three platforms each have their own snapshot call, and
 * the screen-capture crates that paper over that are documented as unreliable
 * on Wayland. The reasoning is in
 * `docs/superpowers/specs/2026-09-09-capture-design.md` §3.
 *
 * So the window draws itself instead, with web APIs that behave the same on
 * every platform: the tree is serialised into an SVG `foreignObject`, drawn to
 * a canvas, and the live canvases are composited back on top by hand.
 *
 * That last step is not optional. A `<canvas>` serialises as an empty element
 * — its pixels are not part of its markup — so the terminal arrives blank
 * unless it is drawn separately. Hence `canvasPatches`.
 */

/** A live canvas, and where it sits relative to the captured root. */
export interface CanvasPatch {
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where each canvas under `root` sits, in root-relative CSS pixels.
 *
 * Zero-sized canvases are dropped rather than drawn: `drawImage` throws on a
 * zero-width source, and a terminal that has not been laid out yet is exactly
 * the case that produces one.
 */
export function canvasPatches(root: HTMLElement): CanvasPatch[] {
  const base = root.getBoundingClientRect();
  return [...root.querySelectorAll("canvas")]
    .map((canvas) => {
      const r = canvas.getBoundingClientRect();
      return {
        canvas,
        x: r.left - base.left,
        y: r.top - base.top,
        width: r.width,
        height: r.height,
      };
    })
    .filter((p) => p.width > 0 && p.height > 0 && p.canvas.width > 0 && p.canvas.height > 0);
}

/**
 * The properties worth carrying into the clone.
 *
 * Copying the whole computed style — some 340 properties per element — makes
 * the serialised document enormous and slow to parse for no gain. This is the
 * set that decides what the app actually looks like.
 */
const CARRIED = [
  // Backgrounds and borders in longhand, never as the shorthands.
  // `border` collapses four sides into one declaration, so an element with
  // `border-left: 2px solid transparent` and nothing elsewhere came back as a
  // 2px box on all four sides — every item in the rail was drawn with an
  // outline it does not have. `border-width`, `-style` and `-color` each keep
  // their four values and round-trip exactly.
  "background-color", "background-image", "background-position",
  "background-repeat", "background-size", "background-clip",
  "border-width", "border-style", "border-color", "border-radius",
  "box-shadow", "box-sizing",
  "color", "display", "flex", "flex-direction", "align-items", "justify-content",
  // No `font` shorthand: it resets line-height to normal, and a terminal that
  // loses its line height stops lining up.
  "font-family", "font-size", "font-style", "font-variant-numeric",
  "font-weight", "gap", "grid-template-columns", "grid-template-rows",
  "height", "letter-spacing", "line-height",
  // `list-style: none` is a reset, and a reset that does not survive the clone
  // is a bullet the app never had: the rail is a <ul>, so every section came
  // back with a disc beside it. Same reasoning for text-decoration, which
  // reappears as an underline under anything anchor-shaped.
  "list-style", "text-decoration", "vertical-align",
  "margin", "max-height", "max-width",
  "min-height", "min-width", "opacity", "overflow", "padding", "position",
  "text-align", "text-transform", "text-overflow", "top", "left", "right",
  "bottom", "transform", "white-space", "width", "word-break", "z-index",
] as const;

/**
 * Copy the rendered appearance of `source` onto `target`, recursively.
 *
 * A serialised tree carries no stylesheet with it, so without this the capture
 * comes out as unstyled text on white. The two trees are walked in lockstep,
 * which is safe because the clone is structurally identical by construction.
 */
export function inlineStyles(source: Element, target: Element, view: Window): void {
  const computed = view.getComputedStyle(source);
  if (target instanceof HTMLElement || target instanceof SVGElement) {
    let text = "";
    for (const prop of CARRIED) {
      const value = computed.getPropertyValue(prop);
      if (value) text += `${prop}:${value};`;
    }
    target.setAttribute("style", text);
  }
  const from = source.children;
  const to = target.children;
  for (let i = 0; i < from.length && i < to.length; i++) {
    inlineStyles(from[i], to[i], view);
  }
}

/**
 * Wrap serialised markup in an SVG that a browser will render as an image.
 *
 * The `xmlns` on the inner div is what makes the fragment XHTML rather than
 * loose HTML; without it the whole `foreignObject` is silently ignored and the
 * capture comes back empty.
 */
export function buildSvg(markup: string, width: number, height: number): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
    `<foreignObject x="0" y="0" width="100%" height="100%">` +
    `<div xmlns="http://www.w3.org/1999/xhtml">${markup}</div>` +
    `</foreignObject></svg>`
  );
}

/** A data URL for an SVG document, encoded so that `#` and `"` survive. */
export function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Capture scale, clamped.
 *
 * Retina is worth having; a 4x display is not worth a 40 megapixel PNG that
 * takes a second to encode and will be scaled down by whatever it is pasted
 * into.
 */
export function captureScale(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 1) return 1;
  return Math.min(ratio, 2);
}
