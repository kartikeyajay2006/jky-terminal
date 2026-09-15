import { render } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { buildEmblem } from "./emblemSvg";
import { JkyMark } from "./JkyMark";

const pathsOf = (root: Element) => [...root.querySelectorAll("path")].map((p) => p.getAttribute("d"));

describe("the emblem", () => {
  it("is decoration, so it stays out of the way of a screen reader and the keyboard", () => {
    // It always sits beside words that already say what it is — the wordmark
    // in a terminal, the hint in an empty workspace.
    const svg = buildEmblem();
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    expect(svg.getAttribute("focusable")).toBe("false");
  });

  it("draws the same JKY glyph as the mark, so the two cannot drift apart", () => {
    const { container } = render(createElement(JkyMark));
    const mark = container.querySelector("svg")!;
    const glyph = buildEmblem().querySelector(".emblem__mark")!;
    expect(glyph, "the emblem has no mark at its centre").not.toBeNull();
    expect(pathsOf(glyph)).toEqual(pathsOf(mark));
  });

  it("draws in theme colours rather than baked-in ones", () => {
    const markup = buildEmblem().outerHTML;
    expect(markup).toContain("var(--accent");
    expect(markup).not.toMatch(/#[0-9a-fA-F]{6}/);
  });

  it("gives each emblem its own gradients, and points only at its own", () => {
    // Two terminals open side by side each draw one. A shared id would have
    // the second borrow the first one's gradient, and lose it when the first
    // terminal closed.
    const first = buildEmblem();
    const second = buildEmblem();
    const ids = (svg: SVGSVGElement) =>
      [...svg.querySelectorAll("linearGradient, radialGradient")].map((g) => g.id);

    expect(ids(first).length).toBeGreaterThan(0);
    expect(ids(first).filter((id) => ids(second).includes(id))).toEqual([]);

    for (const svg of [first, second]) {
      const own = new Set(ids(svg));
      for (const [, ref] of svg.outerHTML.matchAll(/url\(#([^)]+)\)/g)) {
        expect(own.has(ref), `url(#${ref}) points outside its own emblem`).toBe(true);
      }
    }
  });
});
