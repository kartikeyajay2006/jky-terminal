import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Motion has to be switchable off, and by one switch.
 *
 * `prefers-reduced-motion` is a request from someone who may get motion sick
 * or simply cannot read a moving interface. Honouring it per-rule means
 * honouring it until somebody adds a rule and forgets — so it is honoured
 * once, globally, and these tests are what keep it that way.
 */

const ROOTS = ["src/features", "src/styles", "src/app", "src/components"];

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

const motion = () => readFileSync(join(__dirname, "motion.css"), "utf8");

describe("motion", () => {
  it("finds the stylesheets to check", () => {
    expect(cssFiles().length).toBeGreaterThan(3);
  });

  it("turns every animation and transition off in one place", () => {
    const guard = /@media \(prefers-reduced-motion: reduce\) \{\s*\*,[\s\S]*?\n\}/.exec(motion());
    expect(guard, "no global reduced-motion block in motion.css").not.toBeNull();
    expect(guard![0]).toContain("animation-duration");
    expect(guard![0]).toContain("transition-duration");
    // Without !important a component's own rule outranks the guard.
    expect(guard![0]).toContain("!important");
  });

  /*
   * Not zero.
   *
   * A zero-length animation never fires `animationend`, so anything waiting
   * on one waits for ever — the accessible setting would become the one that
   * hangs the interface.
   */
  it("shortens motion rather than removing it", () => {
    const guard = /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\n\}/.exec(motion())![0];
    expect(guard).not.toMatch(/animation-duration:\s*0s/);
    expect(guard).toMatch(/animation-duration:\s*0\.01ms/);
  });

  // A rule that re-enables motion inside a reduced-motion block undoes the
  // guard for the one person it exists for.
  it("never re-enables motion for someone who asked for less", () => {
    for (const { path, text } of cssFiles()) {
      for (const [, body] of text.matchAll(
        /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g,
      )) {
        expect(
          body,
          `${path} sets a visible duration inside a reduced-motion block`,
        ).not.toMatch(/(animation|transition)(-duration)?:\s*[1-9]\d*m?s/);
      }
    }
  });

  /*
   * An animation has to resolve to a keyframe that is actually loaded.
   *
   * The same hazard the cascade test guards for selectors: a rule naming a
   * keyframe defined in a stylesheet this component does not import is a rule
   * that silently does nothing. Nothing fails, nothing errors — the element
   * simply sits still, and you find out when someone photographs it.
   *
   * `motion.css` counts everywhere because it is loaded once, globally, and
   * is where anything shared belongs.
   */
  it("never animates a keyframe that will not be loaded", () => {
    const shared = new Set([...motion().matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));

    for (const { path, text } of cssFiles()) {
      if (path.endsWith("motion.css")) continue;
      const own = new Set([...text.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]));

      for (const [, name] of text.matchAll(/animation(?:-name)?:\s*([\w-]+)/g)) {
        // `animation: none`, or a shorthand that leads with its duration.
        if (name === "none" || /^\d/.test(name)) continue;
        expect(
          own.has(name) || shared.has(name),
          `${path} animates "${name}", which is defined neither here nor in motion.css`,
        ).toBe(true);
      }
    }
  });

  // The shared vocabulary lives in one file, so there is one list to read
  // when deciding whether there is now too much motion.
  it("keeps the shared animations together", () => {
    const shared = [...motion().matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    expect(shared.length).toBeGreaterThanOrEqual(5);
    for (const name of shared) {
      expect(name, "a shared keyframe should be namespaced").toMatch(/^jky-/);
    }
  });

  // Long enough to read, short enough not to wait for.
  it("keeps the everyday durations quick", () => {
    for (const [, value] of motion().matchAll(/--motion-(?:quick|normal|enter):\s*(\d+)ms/g)) {
      expect(Number(value)).toBeLessThanOrEqual(350);
    }
  });
});
