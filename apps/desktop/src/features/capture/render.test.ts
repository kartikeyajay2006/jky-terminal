import { describe, expect, it } from "vitest";
import { buildSvg, canvasPatches, captureScale, inlineStyles, svgDataUrl } from "./render";

describe("capture scale", () => {
  it("keeps retina detail", () => {
    expect(captureScale(2)).toBe(2);
  });

  it("refuses to render a 4x display at 4x", () => {
    // A 40 megapixel PNG helps nobody and costs a visible pause.
    expect(captureScale(4)).toBe(2);
  });

  it("never scales below 1, whatever the browser reports", () => {
    expect(captureScale(0)).toBe(1);
    expect(captureScale(Number.NaN)).toBe(1);
  });
});

describe("the svg wrapper", () => {
  it("declares the xhtml namespace the fragment needs", () => {
    // Without this the foreignObject is ignored and the capture is blank.
    expect(buildSvg("<p>hi</p>", 10, 20)).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it("is sized in pixels, not percentages", () => {
    const svg = buildSvg("", 640, 480);
    expect(svg).toContain('width="640"');
    expect(svg).toContain('height="480"');
  });

  it("encodes a data url that survives a # in a colour", () => {
    const url = svgDataUrl(buildSvg('<p style="color:#fff">x</p>', 1, 1));
    expect(url.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
    expect(url).not.toContain("#fff");
    expect(decodeURIComponent(url.split(",")[1])).toContain("#fff");
  });
});

describe("canvas patches", () => {
  it("finds a canvas so the terminal is not lost", () => {
    // A canvas serialises as an empty element, so it has to be drawn by hand.
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 100;
    canvas.height = 50;
    root.append(canvas);
    document.body.append(root);

    // jsdom reports every rect as zero, so give the two elements real ones.
    root.getBoundingClientRect = () => ({ left: 10, top: 20 }) as DOMRect;
    canvas.getBoundingClientRect = () =>
      ({ left: 30, top: 60, width: 100, height: 50 }) as DOMRect;

    expect(canvasPatches(root)).toEqual([
      { canvas, x: 20, y: 40, width: 100, height: 50 },
    ]);
    root.remove();
  });

  it("drops a canvas with no size rather than throwing on it", () => {
    // drawImage throws on a zero-width source, which is what an unlaid-out
    // terminal looks like for the first frame.
    const root = document.createElement("div");
    const canvas = document.createElement("canvas");
    canvas.width = 0;
    root.append(canvas);
    document.body.append(root);
    root.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 0, height: 0 }) as DOMRect;

    expect(canvasPatches(root)).toEqual([]);
    root.remove();
  });
});

describe("inlined styles", () => {
  it("carries the rendered appearance onto the clone", () => {
    const source = document.createElement("div");
    source.style.color = "rgb(1, 2, 3)";
    document.body.append(source);
    const clone = source.cloneNode(true) as HTMLElement;

    inlineStyles(source, clone, window);

    expect(clone.getAttribute("style")).toContain("color:rgb(1, 2, 3)");
    source.remove();
  });

  it("reaches children, not just the root", () => {
    const source = document.createElement("div");
    const child = document.createElement("span");
    child.style.fontWeight = "700";
    source.append(child);
    document.body.append(source);
    const clone = source.cloneNode(true) as HTMLElement;

    inlineStyles(source, clone, window);

    expect(clone.children[0].getAttribute("style")).toContain("font-weight:700");
    source.remove();
  });
});
