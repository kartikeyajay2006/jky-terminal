import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Filenames have to survive a case-insensitive filesystem.
 *
 * Linux tells two files apart by case; macOS and Windows, by default, do not.
 * So `snake/SnakeGame.tsx` beside `snake/snakeGame.ts` is two files here and
 * one file there, and TypeScript resolves the import to whichever it saw
 * first — which is how a suite that was green on this machine failed to
 * compile on two of the three platforms it ships to.
 *
 * The build catches it, but only after a push, and only on the runners. This
 * catches it in the same test run as everything else.
 */

const SRC = join(process.cwd(), "src");

interface Entry {
  dir: string;
  name: string;
}

function walk(dir: string, out: Entry[] = []): Entry[] {
  for (const item of readdirSync(dir)) {
    const path = join(dir, item);
    if (statSync(path).isDirectory()) {
      walk(path, out);
      out.push({ dir, name: item });
    } else {
      out.push({ dir, name: item });
    }
  }
  return out;
}

describe("filenames", () => {
  const entries = walk(SRC);

  it("finds the source tree at all", () => {
    // Without this, a wrong root makes every check below vacuously pass.
    expect(entries.length).toBeGreaterThan(30);
  });

  it("never puts two names in one directory that differ only in case", () => {
    const byDir = new Map<string, string[]>();
    for (const { dir, name } of entries) {
      const list = byDir.get(dir) ?? [];
      list.push(name);
      byDir.set(dir, list);
    }

    const clashes: string[] = [];
    for (const [dir, names] of byDir) {
      const seen = new Map<string, string>();
      for (const name of names) {
        const key = name.toLowerCase();
        const first = seen.get(key);
        if (first !== undefined && first !== name) {
          clashes.push(`${dir}: '${first}' and '${name}'`);
        }
        seen.set(key, name);
      }
    }

    expect(
      clashes,
      "These names are the same file on macOS and Windows. Rename one so the " +
        "import a build resolves does not depend on which platform it runs on.",
    ).toEqual([]);
  });

  it("keeps a module and its component distinguishable by more than case", () => {
    // The specific shape that broke: a folder holding both `Thing.tsx` and
    // `thing.ts`. Stripping the extension is what makes them collide, since
    // that is exactly what an import does.
    const byDir = new Map<string, string[]>();
    for (const { dir, name } of entries) {
      if (!/\.(ts|tsx)$/.test(name)) continue;
      const stem = name.replace(/\.(test\.)?(ts|tsx)$/, "");
      const list = byDir.get(dir) ?? [];
      list.push(stem);
      byDir.set(dir, list);
    }

    const clashes: string[] = [];
    for (const [dir, stems] of byDir) {
      const seen = new Map<string, string>();
      for (const stem of stems) {
        const key = stem.toLowerCase();
        const first = seen.get(key);
        if (first !== undefined && first !== stem) {
          clashes.push(`${dir}: '${first}' and '${stem}'`);
        }
        seen.set(key, stem);
      }
    }

    expect(
      clashes,
      "Two modules in one directory whose names differ only in case resolve " +
        "to the same import on a case-insensitive filesystem.",
    ).toEqual([]);
  });
});
