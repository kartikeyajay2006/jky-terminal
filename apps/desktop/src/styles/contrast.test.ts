import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { THEMES } from "../app/theme";

/**
 * Every theme's text has to be readable on its own background.
 *
 * axe cannot check this: jsdom has no layout engine, so its colour-contrast
 * rule is skipped entirely and the a11y suite passes on a theme nobody can
 * read. This computes the WCAG ratio from the token values directly, which
 * needs no layout at all.
 *
 * The failure this guards against is specific and easy to commit: a colour
 * that looks right in a swatch and fails as text. Gold is the obvious case —
 * at its most golden it sits around 3:1 on a light ground.
 */

type Rgb = [number, number, number];

function parseHex(value: string): Rgb | null {
  const hex = value.trim().replace(/^#/, "");
  if (hex.length !== 6 || !/^[0-9a-f]{6}$/i.test(hex)) return null;
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

/** Relative luminance, per WCAG 2.1. */
function luminance([r, g, b]: Rgb): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Read every theme's token values out of the stylesheets. */
function tokensByTheme(): Record<string, Record<string, string>> {
  const dir = join(process.cwd(), "src/styles");
  const css =
    readFileSync(join(dir, "tokens.css"), "utf8") +
    readFileSync(join(dir, "themes.css"), "utf8");

  const out: Record<string, Record<string, string>> = {};

  for (const [, selector, body] of css.matchAll(/(:root[^{]*)\{([^}]*)\}/g)) {
    const named = /data-theme="([^"]+)"/.exec(selector);
    // The bare :root block is the default theme's palette.
    const id = named ? named[1] : "cyberpunk";

    const values: Record<string, string> = { ...(out[id] ?? {}) };
    for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      values[name] = value.trim();
    }
    out[id] = values;
  }
  return out;
}

const THEME_TOKENS = tokensByTheme();

/** Text roles and the minimum ratio each must clear against the ground. */
const REQUIREMENTS: Array<{ token: string; min: number; why: string }> = [
  { token: "--text", min: 4.5, why: "body text" },
  { token: "--text-muted", min: 4.5, why: "secondary text" },
  // Dimmed text is de-emphasised by design; WCAG's large-text floor is the
  // honest bar for it rather than pretending it meets the body-text one.
  { token: "--text-dim", min: 3, why: "de-emphasised text" },
  { token: "--accent", min: 3, why: "links and active states" },
  { token: "--danger", min: 3, why: "error text" },
];

describe("theme contrast", () => {
  it("finds a palette for every theme", () => {
    // Without this a broken parser makes every check below vacuously pass.
    for (const theme of THEMES) {
      expect(THEME_TOKENS[theme.id], `no tokens found for ${theme.id}`).toBeTruthy();
      expect(THEME_TOKENS[theme.id]["--ground"]).toBeTruthy();
    }
  });

  for (const theme of THEMES) {
    for (const { token, min, why } of REQUIREMENTS) {
      it(`${theme.label}: ${why} is readable on its background`, () => {
        const tokens = THEME_TOKENS[theme.id];
        const ground = parseHex(tokens["--ground"]);
        const fg = parseHex(tokens[token]);

        expect(ground, `${theme.id} --ground is not a hex colour`).not.toBeNull();
        expect(fg, `${theme.id} ${token} is not a hex colour`).not.toBeNull();

        const contrast = ratio(fg!, ground!);
        expect(
          contrast,
          `${theme.label} ${token} is ${contrast.toFixed(2)}:1 against --ground, ` +
            `below the ${min}:1 needed for ${why}`,
        ).toBeGreaterThanOrEqual(min);
      });
    }
  }

  it("gives High Contrast a genuinely high ratio, not merely a passing one", () => {
    // The theme exists for people the others fail. Scraping past 4.5:1 would
    // make its name a lie.
    const tokens = THEME_TOKENS.contrast;
    const contrast = ratio(parseHex(tokens["--text"])!, parseHex(tokens["--ground"])!);
    expect(contrast).toBeGreaterThanOrEqual(15);
  });
});
