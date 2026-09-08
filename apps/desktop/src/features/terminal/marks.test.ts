import { describe, expect, it } from "vitest";
import { MarkTracker, parseMark } from "./marks";

const at = (line: number) => ({ line });

describe("reading a mark", () => {
  it("understands the three this app emits", () => {
    expect(parseMark("A")).toEqual({ kind: "prompt", exitCode: null });
    expect(parseMark("C")).toEqual({ kind: "output", exitCode: null });
    expect(parseMark("D;0")).toEqual({ kind: "done", exitCode: 0 });
  });

  it("keeps a non-zero status", () => {
    expect(parseMark("D;127")).toEqual({ kind: "done", exitCode: 127 });
  });

  it("survives a status the shell did not send", () => {
    expect(parseMark("D")).toEqual({ kind: "done", exitCode: null });
  });

  it("ignores parameters it does not know", () => {
    // Other terminals' integrations attach things like `aid=`; an unfamiliar
    // parameter should not lose the mark.
    expect(parseMark("A;aid=7")).toEqual({ kind: "prompt", exitCode: null });
  });

  it("does not choke on B, which this app never emits", () => {
    expect(parseMark("B")).toBeNull();
    expect(parseMark("Z")).toBeNull();
  });
});

describe("tracking commands", () => {
  it("records where output began, which is the whole point", () => {
    const t = new MarkTracker();
    t.prompt(at(10), 0);
    t.output(at(11), 100);
    t.done(at(20), 0, 400);

    const [block] = t.list;
    expect(block.prompt.line).toBe(10);
    expect(block.output?.line).toBe(11);
    expect(block.end?.line).toBe(20);
    expect(block.exitCode).toBe(0);
  });

  it("knows how long a command took", () => {
    const t = new MarkTracker();
    t.prompt(at(0), 0);
    t.output(at(1), 1000);
    t.done(at(5), 0, 3500);

    const [b] = t.list;
    expect(b.finishedAt! - b.startedAt!).toBe(2500);
  });

  it("reports a command as running until it finishes", () => {
    const t = new MarkTracker();
    t.prompt(at(0), 0);
    t.output(at(1), 10);
    expect(t.current?.end).toBeNull();

    t.done(at(4), 0, 20);
    expect(t.current).toBeNull();
  });

  it("does not let a command with no status swallow the ones after it", () => {
    // A shell killed mid-command never sends D. The next prompt has to close
    // the block, or every later command is nested inside a dead one.
    const t = new MarkTracker();
    t.prompt(at(0), 0);
    t.output(at(1), 0);
    t.prompt(at(9), 0); // no D ever arrived
    t.output(at(10), 0);
    t.done(at(12), 0, 0);

    expect(t.list).toHaveLength(2);
    expect(t.list[0].end).toBeNull();
    expect(t.list[1].end?.line).toBe(12);
  });

  it("finds the previous prompt, and keeps moving when asked again", () => {
    const t = new MarkTracker();
    for (const line of [0, 10, 20, 30]) t.prompt(at(line), 0);

    expect(t.previousPrompt(25)).toBe(20);
    expect(t.previousPrompt(20)).toBe(10);
    expect(t.previousPrompt(0)).toBeNull();
  });

  it("finds the next prompt", () => {
    const t = new MarkTracker();
    for (const line of [0, 10, 20]) t.prompt(at(line), 0);

    expect(t.nextPrompt(5)).toBe(10);
    expect(t.nextPrompt(20)).toBeNull();
  });

  it("gives back the last finished command, not one still running", () => {
    const t = new MarkTracker();
    t.prompt(at(0), 0);
    t.output(at(1), 0);
    t.done(at(3), 0, 0);
    t.prompt(at(4), 0);
    t.output(at(5), 0); // still going

    expect(t.last()?.end?.line).toBe(3);
  });

  it("forgets the oldest rather than growing without limit", () => {
    const t = new MarkTracker(3);
    for (const line of [0, 1, 2, 3, 4]) t.prompt(at(line), 0);

    expect(t.list).toHaveLength(3);
    expect(t.list.map((b) => b.prompt.line)).toEqual([2, 3, 4]);
  });

  it("ignores output and done marks with no prompt before them", () => {
    // A terminal attached mid-session sees the tail of a command it never saw
    // start.
    const t = new MarkTracker();
    t.output(at(5), 0);
    t.done(at(6), 0, 0);
    expect(t.list).toHaveLength(0);
  });
});
