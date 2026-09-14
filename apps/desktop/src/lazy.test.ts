import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A section fetched when it is opened stays that way only while nothing else
 * imports it.
 *
 * One static import from anywhere on the entry path — even of a constant —
 * pulls the whole module back into the entry bundle, engines and all. Vite
 * says so only as a warning in a build log, and the build still succeeds, so
 * the first anybody hears of it is a cold start that got slower for no
 * visible reason. This reads the source instead of trusting the comment in
 * `App.tsx`.
 */
const SRC = join(process.cwd(), "src");

const EXTENSIONS = [".tsx", ".ts", "/index.tsx", "/index.ts"];

function resolveModule(fromDir: string, spec: string): string | null {
  const base = resolve(fromDir, spec);
  if (existsSync(base) && !base.endsWith("/")) {
    if (/\.tsx?$/.test(base)) return base;
  }
  for (const ext of EXTENSIONS) {
    if (existsSync(base + ext)) return base + ext;
  }
  return null;
}

/** The modules `App.tsx` fetches on demand, read from its dynamic imports. */
function lazyModules(): string[] {
  const app = readFileSync(join(SRC, "App.tsx"), "utf8");
  return [...app.matchAll(/import\(\s*["'](\.[^"']+)["']\s*\)/g)]
    .map(([, spec]) => resolveModule(SRC, spec))
    .filter((path): path is string => path !== null);
}

/** Every module that can end up in a bundle: no tests, no test setup. */
function bundledSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : bundledSources(path);
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$|\.d\.ts$/.test(entry.name)) return [];
    return [path];
  });
}

/**
 * What a file imports at runtime.
 *
 * `import type` and `export type` are erased and cost nothing, so they are
 * left out. Everything else counts — including `import { type X }`, which is
 * erased too but reads like a value import, and `import type` says what is
 * meant without anybody having to know that.
 */
function runtimeImports(source: string): string[] {
  const fromClauses = /^\s*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+["']([^"']+)["']/gm;
  const bare = /^\s*import\s+["']([^"']+)["']/gm;
  return [...source.matchAll(fromClauses), ...source.matchAll(bare)].map(([, spec]) => spec);
}

describe("sections fetched on demand", () => {
  const lazy = lazyModules();

  it("finds the sections App.tsx fetches on demand", () => {
    // Without this, a parser that stopped matching would make the check
    // below pass for want of anything to check.
    expect(lazy.length).toBeGreaterThanOrEqual(5);
  });

  it("are imported statically by nothing, so they stay out of the entry bundle", () => {
    const offenders: string[] = [];
    for (const file of bundledSources(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const spec of runtimeImports(source)) {
        if (!spec.startsWith(".")) continue;
        const target = resolveModule(dirname(file), spec);
        if (target && lazy.includes(target)) {
          offenders.push(`${relative(SRC, file)} -> ${relative(SRC, target)}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
