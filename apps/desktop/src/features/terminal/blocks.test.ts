import { describe, expect, it } from "vitest";
import {
  actionsFor,
  isReal,
  outputRows,
  rowsOf,
  toneOf,
  tookOf,
  tookText,
  transcript,
  markdownRecord,
} from "./blocks";
import type { CommandBlock } from "./marks";

const block = (over: Partial<CommandBlock> = {}): CommandBlock => ({
  prompt: { line: 10 },
  output: { line: 11 },
  end: { line: 14 },
  exitCode: 0,
  startedAt: 1000,
  finishedAt: 3500,
  command: "cargo test",
  ...over,
});

describe("toneOf", () => {
  it("marks a command that worked apart from one that did not", () => {
    expect(toneOf(block({ exitCode: 0 }))).toBe("ok");
    expect(toneOf(block({ exitCode: 1 }))).toBe("failed");
  });

  it("calls a command with no end still running", () => {
    expect(toneOf(block({ end: null, exitCode: null }))).toBe("running");
  });

  it("does not cry wolf when the shell reported no status", () => {
    // A shell with no integration reports nothing. Marking every command red
    // would make the colour mean nothing on the shells that do report.
    expect(toneOf(block({ exitCode: null }))).toBe("ok");
  });
});

describe("rowsOf", () => {
  it("spans the command and everything it printed", () => {
    expect(rowsOf(block({ prompt: { line: 10 }, end: { line: 14 } }))).toBe(5);
  });

  it("gives a command that printed nothing a row of its own", () => {
    // It still happened, and a zero-height mark cannot be clicked.
    expect(rowsOf(block({ prompt: { line: 7 }, output: null, end: null }))).toBe(1);
  });

  it("measures a running command by how far it has got", () => {
    expect(rowsOf(block({ prompt: { line: 3 }, output: { line: 9 }, end: null }))).toBe(7);
  });
});

describe("isReal", () => {
  it("ignores the status that arrives before anything has run", () => {
    // Both shells report unconditionally, so the first D of a session
    // describes no command at all.
    expect(isReal(block({ output: null, command: "" }))).toBe(false);
  });

  it("keeps a command that ran even if the shell did not name it", () => {
    expect(isReal(block({ command: "" }))).toBe(true);
  });
});

describe("actionsFor", () => {
  it("offers what there is something to do with", () => {
    const a = actionsFor(block(), "954 passed");
    expect(a).toEqual({ copyOutput: true, copyCommand: true, rerun: true, ask: true });
  });

  it("offers no copy for a command that printed nothing", () => {
    expect(actionsFor(block(), "   \n ").copyOutput).toBe(false);
  });

  it("offers nothing that needs a command when the shell never said one", () => {
    const a = actionsFor(block({ command: "" }), "some output");
    expect(a.copyCommand).toBe(false);
    expect(a.rerun).toBe(false);
    expect(a.ask).toBe(false);
  });

  it("offers to explain a failure even when it printed nothing", () => {
    // A command that failed silently is exactly the one worth asking about.
    expect(actionsFor(block({ exitCode: 127 }), "").ask).toBe(true);
  });
});

describe("tookText", () => {
  it("says how long in the roughest unit that is still true", () => {
    expect(tookText(420)).toBe("420ms");
    expect(tookText(4200)).toBe("4.2s");
    expect(tookText(252_000)).toBe("4m 12s");
  });

  it("says a command is still going rather than that it took no time", () => {
    expect(tookText(null)).toBe("still running");
  });

  it("never reports nothing at all for something that happened", () => {
    expect(tookText(0)).toBe("1ms");
  });

  it("measures from when the command started, not when the prompt drew", () => {
    expect(tookOf(block({ startedAt: 1000, finishedAt: 3500 }))).toBe(2500);
  });

  it("has no answer for a command the shell never timed", () => {
    expect(tookOf(block({ startedAt: null }))).toBeNull();
  });
});

describe("transcript", () => {
  it("copies the question with the answer", () => {
    // Output pasted into an issue with no command above it is output nobody
    // can act on.
    expect(transcript("git push", "rejected")).toBe("$ git push\nrejected");
  });

  it("copies just the command when there was no output", () => {
    expect(transcript("clear", "  \n ")).toBe("$ clear");
  });

  it("copies just the output when the shell never named the command", () => {
    expect(transcript("", "some output")).toBe("some output");
  });
});

describe("markdownRecord", () => {
  it("exports command, outcome, duration, and output as a portable record", () => {
    expect(markdownRecord(block(), "45 passed\n")).toBe([
      "## JKY command record",
      "",
      "- Result: exit 0",
      "- Duration: 2.5s",
      "",
      "```sh",
      "cargo test",
      "```",
      "",
      "```text",
      "45 passed",
      "```",
    ].join("\n"));
  });
});

describe("outputRows", () => {
  it("stops before the prompt that followed", () => {
    // `end` is where the next prompt began, so including it would copy a
    // prompt line into every block's output.
    expect(outputRows(block({ output: { line: 11 }, end: { line: 14 } }))).toEqual({
      from: 11,
      to: 13,
    });
  });

  it("reads a single row when output and the next prompt share one", () => {
    expect(outputRows(block({ output: { line: 11 }, end: { line: 11 } }))).toEqual({
      from: 11,
      to: 11,
    });
  });

  it("reads to the end of what is there while it is still running", () => {
    expect(outputRows(block({ output: { line: 5 }, end: null }))).toEqual({ from: 5, to: 5 });
  });

  it("has no answer when the shell never said where output began", () => {
    // Guessing is the thing the marks exist to replace.
    expect(outputRows(block({ output: null }))).toBeNull();
  });
});
