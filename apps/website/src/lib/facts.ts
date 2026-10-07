/**
 * Every number the website states about JKY, read from the repository at
 * build time.
 *
 * A number typed into a page is a promise with nothing keeping it: the README
 * said 121 IPC commands for days after the code had 123. So nothing here is
 * typed in. Each fact is counted the same way the test that pins it counts —
 * the command surface exactly as `tests/security.rs` reads it, the themes
 * from the very token files the app ships — and the page is rebuilt from
 * them on every push.
 *
 * Runs in Node only: during `astro build`, and under Vitest.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The monorepo root: the nearest directory above the cwd with a pnpm workspace. */
export function repoRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`no pnpm-workspace.yaml above ${from}`);
    dir = up;
  }
}

/** Build output and dependencies, which are not the source being counted. */
const SKIP = new Set(["target", "gen", "node_modules", "dist"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (!SKIP.has(entry)) yield* walk(full);
    } else yield full;
  }
}

/** Rust crates in `crates/`: every directory with a Cargo.toml. */
export function countCrates(root = repoRoot()): number {
  const crates = join(root, "crates");
  return readdirSync(crates).filter((name) => existsSync(join(crates, name, "Cargo.toml"))).length;
}

/**
 * IPC commands the window can call, counted exactly as the security test
 * does: a line that is `#[tauri::command]` and nothing else, in any `.rs`
 * file under the desktop crate's `src`.
 */
export function countIpcCommands(root = repoRoot()): number {
  const src = join(root, "apps", "desktop", "src-tauri", "src");
  let count = 0;
  for (const file of walk(src)) {
    if (!file.endsWith(".rs")) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.trim() === "#[tauri::command]") count++;
    }
  }
  return count;
}

/**
 * The names of those commands, from the list the security test pins them to
 * — the one place that says, by name, everything the window may ask for.
 */
export function pinnedCommandNames(root = repoRoot()): string[] {
  const rs = readFileSync(join(root, "apps", "desktop", "src-tauri", "tests", "security.rs"), "utf8");
  const test = rs.split("fn the_exposed_command_surface_is_exactly_what_the_spec_allows")[1] ?? "";
  const list = test.slice(test.indexOf("let expected = vec!["), test.indexOf("];"));
  return [...list.matchAll(/"([a-z0-9_]+)"\.to_string\(\)/g)].map((m) => m[1]);
}

/** Rust test functions: `#[test]` and `#[tokio::test]` attributes. */
export function countRustTests(root = repoRoot()): number {
  let count = 0;
  const roots = [join(root, "crates"), join(root, "apps", "desktop", "src-tauri")];
  for (const base of roots) {
    for (const file of walk(base)) {
      if (!file.endsWith(".rs")) continue;
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const t = line.trim();
        if (t === "#[test]" || t.startsWith("#[tokio::test")) count++;
      }
    }
  }
  return count;
}

/**
 * Interface test cases: each `it(` or `test(` that opens a line in a test
 * file. An `it.each` table counts once, so this is a floor — Vitest itself
 * reports more — which is the right direction for a number on a web page to
 * be wrong in.
 */
export function countFrontendTests(root = repoRoot()): number {
  let count = 0;
  for (const file of walk(join(root, "apps", "desktop", "src"))) {
    if (!/\.test\.tsx?$/.test(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (/^\s*(it|test)(\.each\(.*?\))?\(/.test(line)) count++;
    }
  }
  return count;
}

/** "3,557" becomes "3,500+": a claim that stays true as tests are added. */
export function floorClaim(n: number, step = 100): string {
  return `${(Math.floor(n / step) * step).toLocaleString("en-US")}+`;
}

/** The app's version, from the package the desktop build reads it from. */
export function appVersion(root = repoRoot()): string {
  const pkg = JSON.parse(readFileSync(join(root, "apps", "desktop", "package.json"), "utf8")) as {
    version: string;
  };
  return pkg.version;
}

export type Tokens = Record<string, string>;

/**
 * The colour tokens of every theme, parsed from the app's own CSS.
 *
 * The default theme is the `:root` block of tokens.css; every other theme is
 * a `:root[data-theme="…"]` block in themes.css that overrides some of them.
 * A theme's full set is therefore the default with its overrides on top —
 * the same cascade the browser applies.
 */
export function themeTokens(root = repoRoot()): Record<string, Tokens> {
  const styles = join(root, "apps", "desktop", "src", "styles");
  const base = parseBlocks(readFileSync(join(styles, "tokens.css"), "utf8"));
  const themes = parseBlocks(readFileSync(join(styles, "themes.css"), "utf8"));
  const defaults = base.get("cyberpunk") ?? {};
  const out: Record<string, Tokens> = { cyberpunk: defaults };
  for (const [id, overrides] of themes) out[id] = { ...defaults, ...overrides };
  return out;
}

function parseBlocks(css: string): Map<string, Tokens> {
  const blocks = new Map<string, Tokens>();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of stripped.matchAll(re)) {
    const selector = match[1];
    const body = match[2];
    const ids = [...selector.matchAll(/data-theme="([a-z]+)"/g)].map((m) => m[1]);
    if (ids.length === 0) continue;
    const tokens: Tokens = {};
    for (const decl of body.split(";")) {
      const m = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+?)\s*$/i.exec(decl);
      if (m) tokens[m[1]] = m[2];
    }
    for (const id of ids) blocks.set(id, { ...(blocks.get(id) ?? {}), ...tokens });
  }
  return blocks;
}

/** WCAG 2 relative luminance of `#rrggbb`. */
function luminance(hex: string): number {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) throw new Error(`not a #rrggbb colour: ${hex}`);
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export interface Facts {
  version: string;
  crates: number;
  ipcCommands: number;
  rustTests: number;
  frontendTests: number;
  themes: { id: string; ratio: number }[];
}

export function readFacts(root = repoRoot()): Facts {
  const tokens = themeTokens(root);
  return {
    version: appVersion(root),
    crates: countCrates(root),
    ipcCommands: countIpcCommands(root),
    rustTests: countRustTests(root),
    frontendTests: countFrontendTests(root),
    themes: Object.entries(tokens).map(([id, t]) => ({
      id,
      ratio: Math.round(contrast(t["--text"], t["--ground"]) * 10) / 10,
    })),
  };
}
