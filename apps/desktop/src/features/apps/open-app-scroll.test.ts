import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * An opened app has to be able to scroll.
 *
 * This guards a real regression. `.apps__stage` — the box every opened app's
 * body is rendered into — asks for `flex: 1; min-height: 0; overflow: auto`,
 * which only bounds anything if its parent is a flex column with a height.
 * That context used to come from a base `.apps` rule. When the tile grid moved
 * to the shared `.board` in `styles/board.css`, that rule went with it and
 * `.apps--open` was left as a plain block of automatic height: `flex: 1`
 * became inert, the stage grew to fit its content, and the wrapper's
 * `overflow: hidden` then clipped it with no scrollbar and no way down. Every
 * app that is taller than the window — Gmail, News, GitHub — lost its
 * scrolling at once.
 *
 * jsdom has no layout engine, so no rendering test can see this. Reading the
 * declarations is what catches it.
 */

const CSS = readFileSync(join(__dirname, "Apps.css"), "utf8");

/** The declarations of one rule, by exact selector. */
function block(selector: string): string {
  const at = CSS.indexOf(`${selector} {`);
  if (at === -1) return "";
  return CSS.slice(at, CSS.indexOf("}", at));
}

describe("an opened app scrolls", () => {
  it("gives .apps--open the flex column its stage measures against", () => {
    const open = block(".apps--open");
    expect(open, ".apps--open must exist").not.toBe("");
    expect(open).toMatch(/display:\s*flex/);
    expect(open).toMatch(/flex-direction:\s*column/);
    // A height, or the column has nothing to divide between its children.
    expect(open).toMatch(/height:\s*100%/);
    // Without this a flex item refuses to shrink below its content.
    expect(open).toMatch(/min-height:\s*0/);
  });

  it("keeps the stage itself a bounded scroller", () => {
    const stage = block(".apps__stage");
    expect(stage).toMatch(/flex:\s*1/);
    expect(stage).toMatch(/min-height:\s*0/);
    expect(stage).toMatch(/overflow:\s*auto/);
  });
});
