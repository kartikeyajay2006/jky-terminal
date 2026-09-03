import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A `\u` escape in JSX text is not an escape.
 *
 * Inside a JavaScript string `"×"` is a multiplication sign. Written as
 * JSX *text* — between a tag's angle brackets rather than inside quotes — it
 * is six characters, and React renders them exactly as typed. Nothing fails,
 * nothing warns; the button just says `×` until somebody reads it, which
 * is how this one reached a screenshot.
 *
 * The rule is simple enough to check: if a `\uXXXX` appears on a line with no
 * quote before it, it is text and it is wrong. Write the character.
 */
const ROOTS = ["src/features", "src/app", "src/components"];

function tsxFiles(): { path: string; text: string }[] {
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
      else if (entry.name.endsWith(".tsx")) {
        out.push({ path: full, text: readFileSync(full, "utf8") });
      }
    }
  }

  for (const root of ROOTS) walk(join(__dirname, "../..", root));
  return out;
}

describe("JSX text", () => {
  it("finds the components to check", () => {
    expect(tsxFiles().length).toBeGreaterThan(20);
  });

  it("never writes a unicode escape where it will not be processed", () => {
    const literal: string[] = [];

    for (const { path, text } of tsxFiles()) {
      text.split("\n").forEach((line, i) => {
        const at = line.indexOf("\\u");
        if (at === -1) return;

        // Inside a string or a template it is a real escape and is fine.
        const before = line.slice(0, at);
        const quoted = /["'`]/.test(before);
        // A regular expression is a string for these purposes too.
        if (quoted || before.includes("/")) return;

        literal.push(`${path.split("/").slice(-2).join("/")}:${i + 1} — ${line.trim()}`);
      });
    }

    expect(
      literal,
      "a \\u escape in JSX text renders as the characters you typed; write the character instead",
    ).toEqual([]);
  });
});
