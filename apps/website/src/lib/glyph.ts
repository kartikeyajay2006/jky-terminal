/*
 * The JKY glyph, from the app.
 *
 * Re-exported rather than copied: the site draws the mark from the same
 * coordinates the app draws it from, so a change to the logo lands in both
 * places or neither.
 */
export { JKY_GLYPH } from "../../../desktop/src/components/jkyGlyph";
export { WORDMARK, WORDMARK_WIDTH, isBevel, isFace } from "../../../desktop/src/features/terminal/wordmark";

let issued = 0;

/** An id no other drawing on the page has, so gradients never collide. */
export function uid(prefix: string): string {
  return `${prefix}-${++issued}`;
}
