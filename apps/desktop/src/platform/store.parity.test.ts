import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWebPlatform } from "./web";
import { EVENT_COLOURS } from "./types";
import type { Note } from "./types";

/**
 * The browser mock and the native adapter have to offer the same store.
 *
 * The mock is what every UI test runs against. If it diverges from the real
 * one — a method missing, a save that appends instead of replacing — the
 * suite goes green against behaviour the desktop app does not have. That is
 * exactly how the terminal once shipped running the mock and nobody noticed.
 */

const COLLECTIONS = ["notes", "todos", "events", "reminders"] as const;

describe("store adapter parity", () => {
  const web = createWebPlatform();

  for (const name of COLLECTIONS) {
    it(`the mock offers the whole ${name} surface`, () => {
      const c = web.store[name];
      expect(typeof c.list).toBe("function");
      expect(typeof c.save).toBe("function");
      expect(typeof c.remove).toBe("function");
    });
  }

  it("the native adapter wires every collection to its own commands", () => {
    // Read as source rather than imported: importing tauri.ts pulls in the
    // Tauri runtime, which does not exist under vitest.
    const src = readFileSync(join(process.cwd(), "src/platform/tauri.ts"), "utf8");

    for (const name of COLLECTIONS) {
      const singular = name.slice(0, -1);
      for (const cmd of [
        `store_list_${name}`,
        `store_save_${singular}`,
        `store_delete_${singular}`,
      ]) {
        expect(src, `tauri.ts never invokes ${cmd}`).toContain(`"${cmd}"`);
      }
    }
  });

  it("the Rust side exposes exactly those commands", () => {
    // Both halves of the boundary, checked against each other. A rename on
    // one side alone is the failure this catches.
    const rust = readFileSync(
      join(process.cwd(), "../../apps/desktop/src-tauri/src/commands/store.rs"),
      "utf8",
    );

    for (const name of COLLECTIONS) {
      const singular = name.slice(0, -1);
      for (const cmd of [
        `store_list_${name}`,
        `store_save_${singular}`,
        `store_delete_${singular}`,
      ]) {
        expect(rust, `store.rs has no command ${cmd}`).toContain(`pub fn ${cmd}`);
      }
    }
  });

  it("the colour list matches the Rust enum", () => {
    const model = readFileSync(
      join(process.cwd(), "../../crates/jky-store/src/model.rs"),
      "utf8",
    );
    // A colour on one side only renders as a blank dot or fails to save.
    for (const colour of EVENT_COLOURS) {
      const variant = colour[0].toUpperCase() + colour.slice(1);
      expect(model, `EventColour has no ${variant}`).toContain(`    ${variant},`);
    }
    // Count the variant lines themselves. Splitting on commas counts an
    // attribute line such as #[default] as a variant and undercounts by one.
    const body = model.match(/pub enum EventColour \{([^}]*)\}/)![1];
    const variants = [...body.matchAll(/^\s*([A-Z]\w*),\s*$/gm)].map((m) => m[1]);
    expect(variants.map((v) => v.toLowerCase()).sort()).toEqual([...EVENT_COLOURS].sort());
  });
});

describe("the mock behaves like the real store", () => {
  const note = (id: string, title: string): Note => ({
    id,
    title,
    body: "",
    created_at: "2026-08-27T00:00:00Z",
    updated_at: "2026-08-27T00:00:00Z",
  });

  it("starts empty", async () => {
    expect(await createWebPlatform().store.notes.list()).toEqual([]);
  });

  it("returns the whole collection from a save", async () => {
    // The contract that keeps the UI from rendering something other than
    // what was stored.
    const store = createWebPlatform().store;
    const after = await store.notes.save(note("n1", "one"));
    expect(after).toHaveLength(1);
  });

  it("replaces a known id in place rather than appending", async () => {
    const store = createWebPlatform().store;
    await store.notes.save(note("n1", "one"));
    await store.notes.save(note("n2", "two"));
    const after = await store.notes.save(note("n1", "edited"));

    expect(after.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(after[0].title).toBe("edited");
  });

  it("removes exactly one record", async () => {
    const store = createWebPlatform().store;
    await store.notes.save(note("n1", "one"));
    await store.notes.save(note("n2", "two"));
    expect((await store.notes.remove("n1")).map((n) => n.id)).toEqual(["n2"]);
  });

  it("keeps collections apart", async () => {
    const store = createWebPlatform().store;
    await store.notes.save(note("n1", "one"));
    expect(await store.todos.list()).toEqual([]);
  });

  it("hands back a copy, not its own array", async () => {
    // A caller mutating the result must not silently edit the store.
    const store = createWebPlatform().store;
    const first = await store.notes.save(note("n1", "one"));
    first.push(note("n2", "sneaked in"));
    expect(await store.notes.list()).toHaveLength(1);
  });
});
