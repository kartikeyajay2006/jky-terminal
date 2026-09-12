import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Depth is a scale, not a per-component opinion.
 *
 * Fourteen stylesheets used to roll their own shadow, half of them
 * `rgb(0 0 0 / 45%)`. That is a hard-coded colour, which this codebase does
 * not allow anywhere else — and on the two light themes it is also simply
 * wrong. Their ground is nearly white, and a black bloom under a white card
 * reads as a smudge rather than as height. Nobody noticed because nobody
 * reads the whole app in the light theme.
 *
 * So: `--lift-1/2/3` for how far off the page, `--veil` for frosted chrome,
 * `--scrim` for the dim behind a dialog. Each theme names its own shade.
 */

const ROOTS = ["src/features", "src/styles", "src/app", "src/components"];
const TOKENS = join("src", "styles", "tokens.css");

function cssFiles(): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];

  function walk(dir: string) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".css")) out.push({ path: full, text: readFileSync(full, "utf8") });
    }
  }

  for (const root of ROOTS) walk(join(__dirname, "../..", root));
  return out;
}

const sheets = () => cssFiles().filter((f) => !f.path.endsWith(TOKENS));

describe("depth", () => {
  it("frosts glass through the token, so one place decides how much", () => {
    const rogue: string[] = [];
    for (const { path, text } of sheets()) {
      // `blur(0)` is switching frosting off, which is a component's call.
      for (const m of text.matchAll(/backdrop-filter:\s*blur\(\s*[1-9][^)]*\)/g)) {
        rogue.push(`${path}: ${m[0]}`);
      }
    }
    expect(rogue, "Use var(--veil) for chrome, or var(--scrim) behind a dialog.").toEqual([]);
  });

  it("casts no shadow in a colour the theme did not choose", () => {
    const rogue: string[] = [];
    for (const { path, text } of sheets()) {
      for (const m of text.matchAll(/box-shadow:[^;]+/g)) {
        const rule = m[0];
        // Inset is a vignette, not elevation — it is lighting inside a box
        // and belongs to that box. A fully transparent black is the start of
        // a keyframe and has no colour at all.
        if (rule.includes("inset")) continue;
        for (const black of rule.matchAll(/rgb\(\s*0 0 0\s*\/\s*([\d.]+)%\s*\)/g)) {
          if (Number.parseFloat(black[1]) > 0) rogue.push(`${path}: ${rule.trim()}`);
        }
      }
    }
    expect(rogue, "Elevation is var(--lift-1/2/3); the shade is the theme's.").toEqual([]);
  });

  it("leaves no theme with half a depth scale", () => {
    const themes = readFileSync(join(__dirname, "themes.css"), "utf8");
    for (const block of themes.split(/:root\[data-theme="/).slice(1)) {
      const name = block.slice(0, block.indexOf('"'));
      const lifts = [1, 2, 3].filter((n) => block.includes(`--lift-${n}:`));
      // A theme either takes the default scale whole or replaces it whole.
      // One overridden lift and two inherited is a theme where a dialog
      // floats and a menu does not, for no reason anybody chose.
      expect(lifts.length === 0 || lifts.length === 3, `${name} defines ${lifts.length} of 3 lifts`).toBe(true);
    }
  });

  it("gives High Contrast borders instead of shadows", () => {
    const themes = readFileSync(join(__dirname, "themes.css"), "utf8");
    const block = themes.split(':root[data-theme="contrast"]')[1].split("}")[0];
    // Its ground is pure black, so a shadow conveys nothing — and this is
    // the theme for people who cannot rely on subtle depth at all.
    expect(block).toContain("--lift-2: none;");
  });
});
