import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createWebPlatform } from "./web";

/**
 * The command catalogue exists twice: once in Rust, which the desktop build
 * reads over IPC, and once in the web mock, which the browser build and every
 * test see. Two hand-maintained copies of one list drift, and the drift is
 * invisible — the tests keep passing against the stale copy.
 */
const RUST_SOURCE = join(process.cwd(), "../../crates/jky-pty/src/commands.rs");

function rustCommands(): Array<{ usage: string; names: string[] }> {
  const source = readFileSync(RUST_SOURCE, "utf8");
  const start = source.indexOf("const COMMANDS: &[CommandSpec] = &[");
  const end = source.indexOf("\n];", start);
  const block = source.slice(start, end);

  return [...block.matchAll(/CommandSpec\s*\{([\s\S]*?)\n\s*\},/g)].map(([, body]) => {
    // Parse the names field explicitly. Deriving it by position breaks the
    // moment a command's usage string equals its own first name.
    const namesField = /names:\s*&\[([^\]]*)\]/.exec(body)?.[1] ?? "";
    const names = [...namesField.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const usage = /usage:\s*"([^"]+)"/.exec(body)?.[1] ?? "";
    return { usage, names };
  });
}

describe("command catalogue parity", () => {
  const rust = rustCommands();

  it("finds commands in the Rust source at all", () => {
    // Without this, a stale parser makes every check below vacuously pass.
    expect(rust.length).toBeGreaterThanOrEqual(4);
  });

  it("lists the same commands in both languages", async () => {
    const web = await createWebPlatform().listCommands();
    expect(web.map((c) => c.usage)).toEqual(rust.map((c) => c.usage));
  });

  it("lists the same spellings for each command", async () => {
    const web = await createWebPlatform().listCommands();
    for (const [i, cmd] of web.entries()) {
      expect(cmd.names).toEqual(rust[i].names);
    }
  });

  it("documents every command it lists", async () => {
    const web = await createWebPlatform().listCommands();
    for (const cmd of web) {
      expect(cmd.summary.length).toBeGreaterThan(0);
      expect(cmd.detail.length).toBeGreaterThan(0);
      expect(cmd.names.length).toBeGreaterThan(0);
    }
  });
});
