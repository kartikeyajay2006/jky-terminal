import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recognise } from "./index";
import { outputOf } from "../commandFailure";

/**
 * The recognisers, against output two real shells actually produced.
 *
 * The fixtures were captured by driving `zsh -i` and `bash -i` through a real
 * pty with the shell integration installed, typing seven commands, and
 * recording what came back — escape sequences stripped the way a terminal
 * strips them, and the region between two completion reports kept whole.
 *
 * Hand-written fixtures test what you imagined the output looks like. These
 * test what it is. Two bugs came out of the first run that no invented
 * fixture would have found: a `git log` line beginning with a stray keypad
 * escape, which silently cost one commit in three, and the backspace a shell
 * autosuggestion leaves in the middle of the echoed command.
 */
interface Record {
  code: number;
  cwd: string;
  command: string;
  /** Everything drawn between the previous completion report and this one. */
  region: string;
}

const load = (shell: string): Record[] =>
  JSON.parse(readFileSync(join(__dirname, "fixtures", `${shell}-session.json`), "utf8"));

const TYPED = [
  "",
  "mkdir -p /tmp/jky-e2e/thing",
  "ls -l /tmp/jky-e2e",
  "df -h",
  "git status -s",
  "git log --oneline -3",
  "ps aux",
  "echo plain text output",
];

for (const shell of ["zsh", "bash"]) {
  describe(`a real ${shell} session`, () => {
    const records = load(shell);
    const results = new Map<string, ReturnType<typeof recognise>>();
    for (const record of records) {
      const output = outputOf(record.region.split("\n"), record.command);
      results.set(record.command, recognise({ ...record, output }));
    }

    it("reported every command that was typed", () => {
      expect(records.map((r) => r.command)).toEqual(TYPED);
    });

    it("recognises mkdir, which prints nothing at all", () => {
      const out = results.get("mkdir -p /tmp/jky-e2e/thing");
      expect(out?.kind).toBe("file-action");
      expect(out?.title).toBe("Created /tmp/jky-e2e/thing");
    });

    it("recognises a long listing", () => {
      const out = results.get("ls -l /tmp/jky-e2e");
      expect(out?.kind).toBe("ls");
      if (out?.view.kind !== "table") throw new Error("not a table");
      expect(out.view.rows[0].cells.name).toBe("thing");
      expect(out.view.rows[0].cells.kind).toBe("dir");
    });

    it("recognises df, fullest disk first", () => {
      const out = results.get("df -h");
      expect(out?.kind).toBe("df");
      if (out?.view.kind !== "meters") throw new Error("not meters");
      expect(out.view.meters.length).toBeGreaterThan(1);
      for (const meter of out.view.meters) {
        expect(meter.used).toBeGreaterThanOrEqual(0);
        expect(meter.used).toBeLessThanOrEqual(100);
        expect(meter.label.startsWith("/")).toBe(true);
      }
      expect(out.view.meters[0].used).toBeGreaterThanOrEqual(out.view.meters.at(-1)!.used);
    });

    it("recognises git status without the letters leaking into the path", () => {
      const out = results.get("git status -s");
      expect(out?.kind).toBe("git-status");
      if (out?.view.kind !== "table") throw new Error("not a table");
      for (const row of out.view.rows) {
        expect(row.cells.path).not.toBe("");
        expect(row.cells.path).not.toMatch(/^[ MADRCU?!]{2}\s/);
      }
    });

    /*
     * Three commits, not two.
     *
     * The first run of this test found two: the shell had left a keypad
     * escape at the start of the first line and the parser skipped it. No
     * fixture anybody wrote by hand would have contained that byte.
     */
    it("recognises every line of git log", () => {
      const out = results.get("git log --oneline -3");
      expect(out?.kind).toBe("git-log");
      if (out?.view.kind !== "timeline") throw new Error("not a timeline");
      expect(out.view.entries).toHaveLength(3);
      for (const entry of out.view.entries) {
        expect(entry.meta[0]).toMatch(/^[0-9a-f]{7,}$/);
        expect(entry.title).not.toBe("");
      }
    });

    it("recognises ps", () => {
      const out = results.get("ps aux");
      expect(out?.kind).toBe("ps");
      if (out?.view.kind !== "table") throw new Error("not a table");
      expect(out.view.rows.length).toBeGreaterThan(20);
      for (const row of out.view.rows) expect(row.cells.pid).toMatch(/^\d+$/);
    });

    /*
     * The ordinary case, and the one that has to stay ordinary.
     *
     * Most commands are not tables. A terminal that produced a panel for
     * `echo` would be one you fought rather than used.
     */
    it("says nothing about a command that is just text", () => {
      expect(results.get("echo plain text output")).toBeNull();
    });

    it("ignores the empty command the first prompt reports", () => {
      expect(results.get("")).toBeNull();
    });
  });
}
