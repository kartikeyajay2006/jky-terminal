import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A modifier that loses to the class it modifies is a rule that does nothing.
 *
 * This is not hypothetical. `.panel--wide { max-width: 1280px }` lived in
 * `Dashboard.css` and `.panel { max-width: 860px }` in `Settings.css`. Equal
 * specificity, so the later stylesheet won — and since Settings is imported
 * after Dashboard, the dashboard's overview was silently capped at the reading
 * width it was explicitly opting out of. Nothing failed; it just looked wrong,
 * and stayed wrong until someone photographed it.
 *
 * Writing the modifier as `.panel.panel--wide` makes it win on specificity
 * rather than on import order, which is not something a component should have
 * to know about.
 */

const STYLE_ROOTS = ["src/features", "src/styles", "src/app", "src/components"];

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
      else if (entry.name.endsWith(".css")) {
        out.push({ path: full, text: readFileSync(full, "utf8") });
      }
    }
  }

  for (const root of STYLE_ROOTS) walk(join(__dirname, "../..", root));
  return out;
}

/**
 * Every selector that appears at the head of a rule.
 *
 * Comments are stripped first. Without that, any rule preceded by one is
 * missed — which in this codebase is most of them, and included the very rule
 * that prompted this test.
 */
function selectors(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...bare.matchAll(/(^|\}|;)\s*([^{}@;]+?)\s*\{/g)]
    .flatMap((m) => m[2].split(","))
    .map((s) => s.trim())
    .filter((s) => s.startsWith("."));
}

describe("stylesheet cascade", () => {
  it("finds the stylesheets to check", () => {
    expect(cssFiles().length).toBeGreaterThan(3);
  });

  /*
   * Within one file a bare modifier is fine: it sits after its base, and
   * source order settles the tie where anyone editing can see it.
   *
   * Across files it is not. Two stylesheets, equal specificity, and the winner
   * is decided by which component happened to be imported last — a fact
   * neither file mentions and neither author controls. That is what silently
   * capped the dashboard's overview at the reading width it was explicitly
   * opting out of.
   */
  it("never leaves a modifier to beat a base class in another file", () => {
    const baseFiles = new Map<string, Set<string>>();
    const modifiers: { path: string; selector: string; base: string }[] = [];

    for (const { path, text } of cssFiles()) {
      for (const selector of selectors(text)) {
        const single = selector.match(/^\.([a-z0-9_-]+)$/i);
        if (single) {
          const seen = baseFiles.get(single[1]) ?? new Set();
          seen.add(path);
          baseFiles.set(single[1], seen);
        }

        // `.block--modifier` on its own, not qualified by its base.
        const bare = selector.match(/^\.([a-z0-9_]+)--([a-z0-9_-]+)$/i);
        if (bare) modifiers.push({ path, selector, base: bare[1] });
      }
    }

    const crossFile = modifiers.filter((m) => {
      const where = baseFiles.get(m.base);
      return where !== undefined && !where.has(m.path);
    });

    expect(
      crossFile.map(
        (m) =>
          `${m.selector} in ${m.path.split("/").slice(-2).join("/")} ` +
          `(base .${m.base} is defined in another file)`,
      ),
      "this modifier ties with a base class in a different stylesheet, so import " +
        "order decides which wins. Write it as `.base.base--modifier`.",
    ).toEqual([]);
  });
});
