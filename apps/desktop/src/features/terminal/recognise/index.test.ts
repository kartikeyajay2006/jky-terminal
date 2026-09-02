import { describe, expect, it } from "vitest";
import { RECOGNISERS, recognise } from "./index";
import type { Completion } from "./types";

const done = (command: string, output = "", code = 0): Completion => ({
  command,
  output,
  code,
  cwd: "/repo",
});

describe("recognise", () => {
  it("picks the right one for each command", () => {
    expect(recognise(done("mkdir thing"))!.kind).toBe("file-action");
    expect(recognise(done("git status -s", " M a.rs"))!.kind).toBe("git-status");
    expect(
      recognise(
        done("df -h", "Filesystem Size Used Avail Use% Mounted on\n/dev/a 1G 1G 0 50% /"),
      )!.kind,
    ).toBe("df");
  });

  /*
   * A recogniser that knows the command beats one that only knows a shape.
   *
   * `kubectl get pods -o json` prints JSON, and a kubectl recogniser would
   * know more about it than "this is JSON" — so the shape is asked last.
   */
  it("asks the shape recogniser last", () => {
    const body = JSON.stringify({ items: [1, 2, 3], kind: "PodList", apiVersion: "v1" });
    expect(recognise(done("kubectl get pods -o json", body))!.kind).toBe("json");
    expect(RECOGNISERS.at(-1)!(done("kubectl get pods -o json", body))).not.toBeNull();
  });

  /*
   * Null is the ordinary answer.
   *
   * Most commands are not tables, and a terminal producing a panel for every
   * one of them would be a terminal you fought rather than used.
   */
  it("says nothing about the commands that are not anything", () => {
    for (const c of [
      done("cargo build", "   Compiling jky-apps v0.1.0\n    Finished in 3.2s"),
      done("echo hello", "hello"),
      done("vim notes.md"),
      done("cd ..", ""),
    ]) {
      expect(recognise(c), `${c.command} produced a panel`).toBeNull();
    }
  });

  // The shell reports the prompt it drew before anything was typed.
  it("ignores the empty command a fresh prompt reports", () => {
    expect(recognise(done("", ""))).toBeNull();
  });

  it("does not try to read a log file", () => {
    const huge = "line of output\n".repeat(60_000);
    expect(recognise(done("ls -l", huge))).toBeNull();
  });

  /*
   * A recogniser that throws met output it did not expect — the case it
   * should have returned null for. The one thing that must never happen is
   * the terminal breaking over a panel that is only ever an extra.
   */
  it("survives a recogniser that throws", () => {
    const odd = done("ls -l", " \uFFFD".repeat(500) + "\n".repeat(100));
    expect(() => recognise(odd)).not.toThrow();
  });

  it("never returns a view with no content", () => {
    for (const c of [
      done("ls -l", "total 0"),
      done("git status -s", ""),
      done("docker ps", "CONTAINER ID   IMAGE   STATUS   PORTS   NAMES"),
      done("ps aux", "USER PID COMMAND"),
    ]) {
      const out = recognise(c);
      if (!out) continue;
      const view = out.view;
      const empty =
        (view.kind === "table" && view.rows.length === 0) ||
        (view.kind === "meters" && view.meters.length === 0) ||
        (view.kind === "timeline" && view.entries.length === 0) ||
        (view.kind === "facts" && view.facts.length === 0);
      expect(empty, `${c.command} produced an empty ${view.kind}`).toBe(false);
    }
  });

  /*
   * Every action is a command someone could have typed, and typing it is all
   * that happens. Nothing here runs anything on its own — a panel that could
   * quietly `docker stop` would be one you had to trust, and this one only
   * has to be read.
   */
  it("only ever offers commands, never effects", () => {
    for (const out of [
      recognise(done("mkdir thing")),
      recognise(done("git status -s", " M a.rs")),
    ]) {
      for (const action of out?.actions ?? []) {
        expect(action.command.trim()).not.toBe("");
        expect(action.key).toMatch(/^[a-z]$/);
      }
    }
  });
});
