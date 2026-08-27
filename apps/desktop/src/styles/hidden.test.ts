import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The `hidden` attribute has to win against every layout rule in the app.
 *
 * jsdom loads no stylesheets, so `toBeVisible()` in a component test sees
 * only the attribute and reports an element as hidden while the real app
 * paints it in full. That is exactly what happened: the terminal workspace
 * was marked hidden, `.workspace { display: grid }` outranked the browser's
 * own `[hidden] { display: none }`, and it rendered stacked above the
 * assistant. Every component test passed.
 *
 * So this reads the CSS as text, which is the only place the mistake is
 * visible from a test runner.
 */

const STYLES = join(process.cwd(), "src/styles");

/**
 * Comments out.
 *
 * The first version of this matched the example `[hidden] { display: none }`
 * written in the comment above the real rule, and reported the real one as
 * wrong. A test that reads source has to read the source, not the prose
 * about it.
 */
function rules(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function allCss(): Array<{ file: string; text: string }> {
  const out: Array<{ file: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".css")) {
        out.push({ file: path, text: readFileSync(path, "utf8") });
      }
    }
  };
  walk(join(process.cwd(), "src"));
  return out;
}

describe("the hidden attribute", () => {
  it("is forced to hide, in the base stylesheet", () => {
    const base = rules(readFileSync(join(STYLES, "base.css"), "utf8"));
    const rule = /\[hidden\]\s*\{[^}]*\}/.exec(base);

    expect(rule, "base.css has no [hidden] rule at all").not.toBeNull();
    expect(rule![0].replace(/\s+/g, " ")).toMatch(/display:\s*none\s*!important/);
  });

  it("is not left to the browser's own stylesheet to enforce", () => {
    // Without !important any class that sets display outranks it, and the
    // element stays on screen while every test says it is hidden.
    const base = rules(readFileSync(join(STYLES, "base.css"), "utf8"));
    const withoutBang = /\[hidden\]\s*\{\s*display:\s*none;\s*\}/.test(base);
    expect(withoutBang, "the [hidden] rule can be outranked by any class").toBe(false);
  });

  it("needs no per-element workarounds any more", () => {
    // A rule like `.workspace__pane[hidden] { display: none }` is a patch for
    // one element and a sign the global rule is missing. One of those existed,
    // and the element it did not cover is the one that broke.
    for (const { file, text } of allCss()) {
      if (file.endsWith("base.css")) continue;
      const patches = rules(text).match(/\.[\w-]+\[hidden\]/g);
      expect(
        patches,
        `${file} patches ${patches?.join(", ")} individually; base.css covers every element`,
      ).toBeNull();
    }
  });
});
