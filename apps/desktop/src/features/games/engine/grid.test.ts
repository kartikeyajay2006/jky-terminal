import { describe, expect, it } from "vitest";
import { Grid } from "./grid";

describe("the character grid", () => {
  it("starts blank", () => {
    const g = new Grid(4, 2);
    expect(g.toText()).toBe("    \n    ");
  });

  it("refuses a zero or negative size rather than producing a broken buffer", () => {
    expect(new Grid(0, 0).toText()).toBe(" ");
    expect(new Grid(-5, -5).toText()).toBe(" ");
  });

  it("paints a character where it is asked to", () => {
    const g = new Grid(3, 2);
    g.set(1, 1, "#", "accent");
    expect(g.toText()).toBe("   \n # ");
  });

  it("drops anything painted off the board rather than wrapping", () => {
    // Wrapping would put a cactus that ran off the left edge back on the
    // right, which is the sort of thing nobody notices until it happens.
    const g = new Grid(3, 2);
    g.set(-1, 0, "#", "accent");
    g.set(9, 0, "#", "accent");
    g.set(0, -4, "#", "accent");
    g.set(0, 9, "#", "accent");
    expect(g.toText()).toBe("   \n   ");
  });

  it("rounds fractional coordinates, because game positions are fractional", () => {
    const g = new Grid(4, 1);
    g.set(1.6, 0.2, "#", "accent");
    expect(g.toText()).toBe("  # ");
  });

  it("writes a string left to right", () => {
    const g = new Grid(6, 1);
    g.text(1, 0, "abc", "text");
    expect(g.toText()).toBe(" abc  ");
  });

  it("centres a string across the width", () => {
    const g = new Grid(7, 1);
    g.centre(0, "abc", "text");
    expect(g.toText()).toBe("  abc  ");
  });

  it("clears back to a chosen character", () => {
    const g = new Grid(3, 1);
    g.text(0, 0, "abc", "text");
    g.clear(".", "dim");
    expect(g.toText()).toBe("...");
  });

  it("draws horizontal and vertical lines", () => {
    const g = new Grid(4, 3);
    g.hLine(0, 0, 4, "-", "dim");
    g.vLine(0, 0, 3, "|", "dim");
    expect(g.toText()).toBe("|---\n|   \n|   ");
  });

  it("draws a box with corners", () => {
    const g = new Grid(4, 3);
    g.box(0, 0, 4, 3, "dim");
    expect(g.toText()).toBe("┌──┐\n│  │\n└──┘");
  });

  it("ignores a box too small to have an inside", () => {
    const g = new Grid(3, 3);
    g.box(0, 0, 1, 5, "dim");
    expect(g.toText().trim()).toBe("");
  });

  it("fills a rectangle", () => {
    const g = new Grid(4, 3);
    g.fill(1, 1, 2, 2, "#", "accent");
    expect(g.toText()).toBe("    \n ## \n ## ");
  });

  it("lets the background show through a sprite's spaces", () => {
    // The reason sprites are not just repeated text calls: a solid rectangle
    // of blank sky would scrub out the ground the dino stands on.
    const g = new Grid(5, 2);
    g.hLine(0, 1, 5, "=", "dim");
    g.sprite(1, 0, ["###", " # "], "accent");
    // The sprite's own "#" lands on the ground row, but the spaces on either
    // side of it leave the "=" underneath showing.
    expect(g.toText()).toBe(" ### \n==#==");
  });

  it("reads back what is painted at a coordinate", () => {
    const g = new Grid(3, 1);
    g.set(2, 0, "@", "accent");
    expect(g.charAt(2, 0)).toBe("@");
    expect(g.charAt(0, 0)).toBe(" ");
    expect(g.charAt(99, 99)).toBe(" ");
  });

  it("says what is inside the board and what is not", () => {
    const g = new Grid(3, 2);
    expect(g.inside(0, 0)).toBe(true);
    expect(g.inside(2, 1)).toBe(true);
    expect(g.inside(3, 1)).toBe(false);
    expect(g.inside(-1, 0)).toBe(false);
  });
});

describe("rendering to HTML", () => {
  it("groups a run of identically painted cells into one span", () => {
    // A span per cell is three thousand elements a frame, which no browser
    // lays out at sixty.
    const g = new Grid(4, 1);
    g.text(0, 0, "aaaa", "accent");
    expect(g.toHtml()).toBe('<span class="gp-accent">aaaa</span>');
  });

  it("breaks a span where the paint changes", () => {
    const g = new Grid(4, 1);
    g.text(0, 0, "ab", "accent");
    g.text(2, 0, "cd", "mint");
    expect(g.toHtml()).toBe(
      '<span class="gp-accent">ab</span><span class="gp-mint">cd</span>',
    );
  });

  it("puts a newline between rows and not after the last", () => {
    const g = new Grid(2, 2);
    expect(g.toHtml().split("\n")).toHaveLength(2);
    expect(g.toHtml().endsWith("\n")).toBe(false);
  });

  it("escapes the three characters that could break out of the markup", () => {
    // The grid's own output goes in via innerHTML, so a stray angle bracket
    // in a sprite would be parsed as a tag rather than drawn.
    const g = new Grid(3, 1);
    g.text(0, 0, "<&>", "text");
    const html = g.toHtml();
    expect(html).toContain("&lt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&gt;");
    expect(html).not.toMatch(/<span[^>]*>[^<]*<(?!\/span)/);
  });

  it("emits far fewer spans than cells on a typical board", () => {
    // The guarantee the run-grouping exists to provide, asserted rather than
    // assumed: a sky of blanks must not become a thousand elements.
    const g = new Grid(96, 26);
    g.hLine(0, 19, 96, "═", "dim");
    g.sprite(8, 14, ["####", "####"], "mint");
    const spans = (g.toHtml().match(/<span/g) ?? []).length;
    expect(spans).toBeLessThan(100);
  });
});
