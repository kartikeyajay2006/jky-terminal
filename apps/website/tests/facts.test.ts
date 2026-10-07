import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appVersion,
  contrast,
  countCrates,
  countFrontendTests,
  countIpcCommands,
  countRustTests,
  floorClaim,
  repoRoot,
  themeTokens,
} from "../src/lib/facts";

const root = repoRoot();

describe("the numbers the site states", () => {
  it("counts exactly the IPC commands the security test pins", () => {
    // The pinned list is what CI holds the real surface to, so the site's
    // count agreeing with it means the site agrees with the binary.
    const rs = readFileSync(join(root, "apps/desktop/src-tauri/tests/security.rs"), "utf8");
    const test = rs.split("fn the_exposed_command_surface_is_exactly_what_the_spec_allows")[1];
    const list = test.slice(test.indexOf("let expected = vec!["), test.indexOf("];"));
    const pinned = [...list.matchAll(/"([a-z0-9_]+)"\.to_string\(\)/g)].length;

    expect(pinned).toBeGreaterThan(100);
    expect(countIpcCommands(root)).toBe(pinned);
  });

  it("counts every crate the Cargo workspace builds from crates/", () => {
    expect(readFileSync(join(root, "Cargo.toml"), "utf8")).toContain('"crates/*"');
    expect(countCrates(root)).toBeGreaterThanOrEqual(20);
  });

  it("finds the test suites it claims a floor for", () => {
    expect(countRustTests(root)).toBeGreaterThan(1000);
    expect(countFrontendTests(root)).toBeGreaterThan(2000);
  });

  it("reads the version the desktop build announces", () => {
    expect(appVersion(root)).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe("the themes, read from the app's own token files", () => {
  const themes = themeTokens(root);

  it("are the seven the app ships", () => {
    expect(Object.keys(themes).sort()).toEqual([
      "contrast",
      "cyberpunk",
      "dracula",
      "gold",
      "light",
      "nord",
      "solarized",
    ]);
  });

  it("each give text AAA contrast on its own ground", () => {
    for (const [id, tokens] of Object.entries(themes)) {
      const ratio = contrast(tokens["--text"], tokens["--ground"]);
      expect(ratio, id).toBeGreaterThanOrEqual(7);
    }
  });

  it("give every text colour the site uses AA contrast on every surface it sits on", () => {
    // The app checks --text on --ground. The site also sets paragraphs in
    // --text-muted and puts text on --surface panels, so those pairs must
    // hold too — in all seven themes, because a visitor can pick any of them.
    // --text-dim is deliberately absent: it is under 4.5:1 in Cyberpunk, so
    // the site never sets readable text in it.
    for (const [id, t] of Object.entries(themes)) {
      for (const fg of ["--text", "--text-muted"]) {
        for (const bg of ["--ground", "--surface", "--surface-raised"]) {
          expect(contrast(t[fg], t[bg]), `${id} ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("inherit the default tokens a theme does not override", () => {
    // themes.css redefines colours only; the font stacks come from tokens.css.
    expect(themes.nord["--font-mono"]).toBe(themes.cyberpunk["--font-mono"]);
    expect(themes.nord["--accent"]).not.toBe(themes.cyberpunk["--accent"]);
  });
});

describe("helpers", () => {
  it("computes WCAG contrast at its extremes", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#777777")).toBeCloseTo(1, 5);
  });

  it("floors a count into a claim that stays true", () => {
    expect(floorClaim(3557)).toBe("3,500+");
    expect(floorClaim(3600)).toBe("3,600+");
  });
});
