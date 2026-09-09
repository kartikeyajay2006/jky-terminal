import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_BINDINGS } from "./keymap";

/**
 * The keymap exists twice: once in Rust, which the desktop build uses, and
 * once here, which the browser build and every test uses. Two copies of the
 * same table drift, and the drift is invisible — the tests keep passing
 * against the stale copy while the real app is bound to something else.
 *
 * So this reads the Rust source and compares. The same blunt instrument the
 * provider catalogue is kept honest with, for the same reason.
 */
const RUST_SOURCE = join(process.cwd(), "../../crates/jky-keys/src/map.rs");

/** Pull `Variant => "value",` pairs out of one `match self` arm block. */
function armsOf(source: string, fnName: string): Record<string, string> {
  const start = source.indexOf(`pub fn ${fnName}(self)`);
  if (start === -1) throw new Error(`no fn ${fnName} in map.rs`);
  const body = source.slice(start, source.indexOf("\n    }", start));

  const out: Record<string, string> = {};
  for (const [, variants, value] of body.matchAll(
    /Action::(\w+(?:\s*\|\s*Action::\w+)*)\s*=>\s*"([^"]+)"/g,
  )) {
    for (const variant of variants.split("|")) {
      out[variant.replace("Action::", "").trim()] = value;
    }
  }
  return out;
}

describe("the keymap the browser build ships", () => {
  const source = readFileSync(RUST_SOURCE, "utf8");
  const ids = armsOf(source, "id");
  const labels = armsOf(source, "label");
  const chords = armsOf(source, "default_chord");

  it("covers every action Rust defines, and no more", () => {
    expect(new Set(DEFAULT_BINDINGS.map((b) => b.action))).toEqual(new Set(Object.values(ids)));
  });

  it("agrees with Rust about what each action is bound to", () => {
    for (const [variant, id] of Object.entries(ids)) {
      const here = DEFAULT_BINDINGS.find((b) => b.action === id);
      expect(here, `${id} missing from the browser keymap`).toBeDefined();
      expect(here!.default_chord, `${id} default chord`).toBe(chords[variant]);
    }
  });

  it("agrees with Rust about what each action is called", () => {
    for (const [variant, id] of Object.entries(ids)) {
      expect(DEFAULT_BINDINGS.find((b) => b.action === id)!.label).toBe(labels[variant]);
    }
  });

  it("ships nothing bound twice", () => {
    const chordList = DEFAULT_BINDINGS.map((b) => b.default_chord);
    expect(new Set(chordList).size).toBe(chordList.length);
  });
});
