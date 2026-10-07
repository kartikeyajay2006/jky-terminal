import { describe, expect, it } from "vitest";
import { run, words } from "../src/lib/shell/commands";
import { Shell } from "../src/lib/shell/engine";
import type { Block, ShellContext } from "../src/lib/shell/types";

let theme = "cyberpunk";
const ctx: ShellContext = {
  version: "0.1.0",
  themes: [
    { id: "cyberpunk", label: "Cyberpunk" },
    { id: "nord", label: "Nord" },
    { id: "gold", label: "Gold" },
  ],
  currentTheme: () => theme,
};

const text = (blocks: Block[]) =>
  blocks
    .flatMap((b) => (b.kind === "lines" ? b.lines.map((l) => l.map((s) => s.text).join("")) : []))
    .join("\n");
const panels = (blocks: Block[]) => blocks.filter((b) => b.kind === "panel");

describe("the commands", () => {
  it("draws a panel beneath docker ps, and keeps the raw table above it", () => {
    const { blocks } = run("docker ps", ctx, "~");
    expect(blocks[0].kind).toBe("lines");
    expect(text(blocks)).toContain("CONTAINER ID");
    const [panel] = panels(blocks);
    expect(panel).toMatchObject({ kind: "panel", panel: { kind: "docker" } });
  });

  it("steps aside when the output is piped, as the app's recognisers do", () => {
    const { blocks } = run("docker ps | grep api", ctx, "~");
    expect(panels(blocks)).toHaveLength(0);
    expect(text(blocks)).toContain("acme/api");
    expect(text(blocks)).not.toContain("redis");
    expect(blocks.some((b) => b.kind === "note")).toBe(true);
  });

  it("gives every recognised command its panel", () => {
    for (const cmd of ["git status -s", "git log", "df -h", "ls -l", "cat package.json", "mkdir demo"]) {
      expect(panels(run(cmd, ctx, "~").blocks), cmd).toHaveLength(1);
    }
  });

  it("asks before it acts, and makes a destructive command be typed back", () => {
    const safe = run("ask what is on port 8080", ctx, "~").blocks[0];
    expect(safe.kind).toBe("approval");
    if (safe.kind === "approval") expect(safe.proposal.confirm).toBeUndefined();

    const risky = run("ask clean the build", ctx, "~").blocks[0];
    expect(risky.kind).toBe("approval");
    if (risky.kind === "approval") {
      expect(risky.proposal.command).toBe("rm -rf dist");
      expect(risky.proposal.confirm).toBe("dist");
    }
  });

  it("switches theme by id or by name, and refuses one that does not exist", () => {
    expect(run("jky theme nord", ctx, "~").effects?.theme).toBe("nord");
    expect(run("jky theme Gold", ctx, "~").effects?.theme).toBe("gold");
    const missing = run("jky theme sepia", ctx, "~");
    expect(missing.effects?.theme).toBeUndefined();
    expect(text(missing.blocks)).toContain('no theme called "sepia"');
  });

  it("lists the themes with the current one marked", () => {
    theme = "nord";
    expect(text(run("jky theme", ctx, "~").blocks)).toMatch(/● nord/);
    theme = "cyberpunk";
  });

  it("answers an unknown command the way a shell does", () => {
    expect(text(run("frobnicate", ctx, "~").blocks)).toContain("command not found: frobnicate");
  });

  it("splits words and keeps quoted ones whole", () => {
    expect(words(`ask "what is this" now`)).toEqual(["ask", "what is this", "now"]);
  });
});

describe("the line editor", () => {
  it("completes a unique command with a trailing space", () => {
    const sh = new Shell(ctx);
    sh.insert("doc");
    expect(sh.complete()).toEqual([]);
    expect(sh.line).toBe("docker ");
    sh.complete();
    expect(sh.line).toBe("docker ps ");
  });

  it("completes theme names after jky theme", () => {
    const sh = new Shell(ctx);
    sh.insert("jky theme n");
    sh.complete();
    expect(sh.line).toBe("jky theme nord ");
  });

  it("lists the options when there are several, after completing what they share", () => {
    const sh = new Shell(ctx);
    sh.insert("jky theme ");
    expect(sh.complete().length).toBeGreaterThan(3);
    const sh2 = new Shell(ctx);
    sh2.insert("d");
    const options = sh2.complete();
    expect(options).toEqual(expect.arrayContaining(["docker", "df", "date"]));
  });

  it("walks history with the arrows and returns to the draft", () => {
    const sh = new Shell(ctx);
    sh.set("git log");
    sh.submit();
    sh.set("df -h");
    sh.submit();
    sh.set("half-typ");
    sh.up();
    expect(sh.line).toBe("df -h");
    sh.up();
    expect(sh.line).toBe("git log");
    sh.up();
    expect(sh.line).toBe("git log");
    sh.down();
    sh.down();
    expect(sh.line).toBe("half-typ");
  });

  it("edits in the middle of a line", () => {
    const sh = new Shell(ctx);
    sh.insert("git lg");
    sh.left();
    sh.insert("o");
    expect(sh.line).toBe("git log");
    sh.end();
    sh.deleteWord();
    expect(sh.line).toBe("git ");
  });

  it("does not file empty lines or repeats in history", () => {
    const sh = new Shell(ctx);
    sh.set("ls");
    sh.submit();
    sh.set("ls");
    sh.submit();
    sh.set("   ");
    sh.submit();
    sh.up();
    expect(sh.line).toBe("ls");
    sh.up();
    expect(sh.line).toBe("ls");
  });
});
