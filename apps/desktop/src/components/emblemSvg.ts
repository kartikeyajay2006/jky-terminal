import { JKY_GLYPH } from "./jkyGlyph";
import "./Emblem.css";

/**
 * The emblem: the JKY mark inside the instruments of a terminal that is on.
 *
 * Built with the DOM rather than React, because its main home is a terminal
 * decoration — an element xterm creates and pins to a line of output — and
 * there is no React tree in there to render into. `Emblem` wraps this same
 * builder for the places React does draw, so there is one drawing, not two.
 *
 * Every colour is a theme token, so it recolours with the theme and never
 * shows a palette the theme did not choose.
 */

const SVG = "http://www.w3.org/2000/svg";

/** Emblems made so far, so each one's gradients get ids nobody else has. */
let issued = 0;

type Attrs = Record<string, string | number>;

function draw(tag: string, attrs: Attrs, children: Element[] = []): Element {
  const node = document.createElementNS(SVG, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  node.append(...children);
  return node;
}

/*
 * Geometry, on a 120-unit grid centred at 60,60.
 *
 * The arcs are dashes on a circle of radius 44, whose circumference is
 * 276.46: a long dash and a short one opposite it. The sweep is a 45-degree
 * wedge of radius 52. The three orbiting nodes sit a third of a turn apart on
 * radius 36.
 */
const ARC_RADIUS = 44;
const ARC_LENGTH = 2 * Math.PI * ARC_RADIUS;

export function buildEmblem(): SVGSVGElement {
  const uid = `jky-emblem-${++issued}`;
  const stroke = `${uid}-stroke`;
  const halo = `${uid}-halo`;
  const sweep = `${uid}-sweep`;
  const lit = `url(#${stroke})`;
  const round = (n: number) => Number(n.toFixed(2));

  return draw(
    "svg",
    { class: "emblem", viewBox: "0 0 120 120", fill: "none", "aria-hidden": "true", focusable: "false" },
    [
      draw("defs", {}, [
        draw("linearGradient", { id: stroke, gradientUnits: "userSpaceOnUse", x1: 0, y1: 0, x2: 120, y2: 120 }, [
          draw("stop", { offset: "0", "stop-color": "var(--accent)" }),
          draw("stop", { offset: "0.55", "stop-color": "var(--violet)" }),
          draw("stop", { offset: "1", "stop-color": "var(--magenta)" }),
        ]),
        draw("radialGradient", { id: halo, gradientUnits: "userSpaceOnUse", cx: 60, cy: 60, r: 58 }, [
          draw("stop", { offset: "0", "stop-color": "var(--accent)", "stop-opacity": "0.28" }),
          draw("stop", { offset: "1", "stop-color": "var(--accent)", "stop-opacity": "0" }),
        ]),
        draw("linearGradient", { id: sweep, gradientUnits: "userSpaceOnUse", x1: 60, y1: 60, x2: 78, y2: 10 }, [
          draw("stop", { offset: "0", "stop-color": "var(--accent)", "stop-opacity": "0" }),
          draw("stop", { offset: "1", "stop-color": "var(--accent)", "stop-opacity": "0.5" }),
        ]),
      ]),

      // A haze of the accent behind everything, so the emblem reads as lit.
      draw("circle", { class: "emblem__halo", cx: 60, cy: 60, r: 58, fill: `url(#${halo})` }),

      // The dial: a ring of tick marks, turning slowest.
      draw("circle", {
        class: "emblem__ring",
        cx: 60,
        cy: 60,
        r: 54,
        stroke: "var(--accent)",
        "stroke-width": 1.2,
        "stroke-linecap": "round",
        "stroke-dasharray": "0.6 5.05",
      }),

      // The sweep, fading toward its trailing edge like a radar's.
      draw("path", { class: "emblem__sweep", d: "M60 60 L60 8 A52 52 0 0 1 96.77 23.23 Z", fill: `url(#${sweep})` }),

      // Two arcs turning the other way, so the dial is never still.
      draw("g", { class: "emblem__arcs", stroke: lit, "stroke-width": 2, "stroke-linecap": "round" }, [
        draw("circle", { cx: 60, cy: 60, r: ARC_RADIUS, "stroke-dasharray": `64 ${round(ARC_LENGTH - 64)}` }),
        draw("circle", {
          cx: 60,
          cy: 60,
          r: ARC_RADIUS,
          "stroke-dasharray": `16 ${round(ARC_LENGTH - 16)}`,
          "stroke-dashoffset": round(-ARC_LENGTH / 2),
        }),
      ]),

      // Three nodes in orbit, one per stop of the theme's gradient.
      draw("g", { class: "emblem__orbit" }, [
        draw("circle", { cx: 60, cy: 24, r: 2.4, fill: "var(--accent)" }),
        draw("circle", { cx: 91.18, cy: 78, r: 2, fill: "var(--violet)" }),
        draw("circle", { cx: 28.82, cy: 78, r: 2, fill: "var(--magenta)" }),
      ]),

      // The mark itself, at the centre, scaled from its 64-unit grid.
      draw(
        "g",
        {
          class: "emblem__mark",
          transform: "translate(40 40) scale(0.625)",
          stroke: lit,
          "stroke-width": JKY_GLYPH.stroke,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
        },
        [
          draw("path", { d: JKY_GLYPH.chevron }),
          draw("path", { d: JKY_GLYPH.hook }),
          draw("circle", {
            class: "emblem__spark",
            cx: JKY_GLYPH.spark.cx,
            cy: JKY_GLYPH.spark.cy,
            r: JKY_GLYPH.spark.r,
            fill: "var(--accent)",
            stroke: "none",
          }),
        ],
      ),
    ],
  ) as SVGSVGElement;
}
