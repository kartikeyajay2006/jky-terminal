import { describe, expect, it } from "vitest";
import {
  byReminderTime,
  decodeCommand,
  encodeCommand,
  fail,
  isClockTime,
  ok,
  renderResult,
  resolveHandle,
} from "./shellCommand";

describe("decodeCommand", () => {
  it("reads back what the encoder wrote", () => {
    const command = { verb: "note.new", args: ["Shopping list"] };
    expect(decodeCommand(encodeCommand(command))).toEqual(command);
  });

  it("keeps quotes, newlines and the terminator intact", () => {
    // The whole reason the payload is base64 JSON: any of these reaching the
    // escape sequence raw would end it early and print the rest as garbage.
    const command = {
      verb: "note.write",
      args: ["1", 'say "hi"\nthen  and \\ too'],
    };
    expect(decodeCommand(encodeCommand(command))).toEqual(command);
  });

  it("survives text that is not ASCII", () => {
    const command = { verb: "todo.add", args: ["café — 日本語 🎮"] };
    expect(decodeCommand(encodeCommand(command))).toEqual(command);
  });

  it("ignores a payload that is not ours", () => {
    // OSC 1337 is shared space. Another program's sequence must pass through
    // rather than be guessed at.
    expect(decodeCommand("RemoteHost=box")).toBeNull();
    expect(decodeCommand("")).toBeNull();
  });

  it("ignores our prefix with nothing after it", () => {
    expect(decodeCommand("JKYCmd=")).toBeNull();
    expect(decodeCommand("JKYCmd=   ")).toBeNull();
  });

  it("ignores a payload that is not base64", () => {
    expect(decodeCommand("JKYCmd=not base64 at all!!")).toBeNull();
  });

  it("ignores base64 that is not JSON", () => {
    expect(decodeCommand(`JKYCmd=${btoa("hello")}`)).toBeNull();
  });

  it("ignores JSON of the wrong shape", () => {
    const bad = [
      "[]",
      "null",
      '"a string"',
      "42",
      '{"args":["x"]}', // no verb
      '{"verb":"","args":[]}', // empty verb
      '{"verb":"note.new"}', // no args
      '{"verb":"note.new","args":"x"}', // args not an array
      '{"verb":"note.new","args":[1,2]}', // args not strings
      '{"verb":"note.new","args":["ok",null]}',
    ];
    for (const json of bad) {
      expect(decodeCommand(`JKYCmd=${btoa(json)}`), json).toBeNull();
    }
  });

  it("accepts a command with no arguments", () => {
    expect(decodeCommand(encodeCommand({ verb: "open", args: [] }))).toEqual({
      verb: "open",
      args: [],
    });
  });
});

describe("resolveHandle", () => {
  const items = [{ n: "a" }, { n: "b" }, { n: "c" }];

  it("counts from one, the way the listing prints", () => {
    expect(resolveHandle(items, "1")).toEqual({ n: "a" });
    expect(resolveHandle(items, "3")).toEqual({ n: "c" });
  });

  it("tolerates surrounding space", () => {
    expect(resolveHandle(items, " 2 ")).toEqual({ n: "b" });
  });

  it("refuses zero, negatives and anything past the end", () => {
    for (const handle of ["0", "-1", "4", "99"]) {
      expect(resolveHandle(items, handle), handle).toBeNull();
    }
  });

  it("refuses anything that is not a plain number", () => {
    for (const handle of ["", "a", "1a", "1.5", "١", "+1", " "]) {
      expect(resolveHandle(items, handle), handle).toBeNull();
    }
  });

  it("resolves in the listing's order, not the array's", () => {
    // `jky reminder done 1` has to tick the one printed first, which for
    // reminders is the earliest of the day rather than the first added.
    const reminders = [
      { at: "18:00", text: "Evening" },
      { at: "07:00", text: "Morning" },
    ];
    expect(resolveHandle(reminders, "1", byReminderTime)?.text).toBe("Morning");
    expect(resolveHandle(reminders, "2", byReminderTime)?.text).toBe("Evening");
  });

  it("does not reorder the caller's array", () => {
    const reminders = [
      { at: "18:00", text: "Evening" },
      { at: "07:00", text: "Morning" },
    ];
    resolveHandle(reminders, "1", byReminderTime);
    expect(reminders[0].text).toBe("Evening");
  });

  it("finds nothing in an empty list", () => {
    expect(resolveHandle([], "1")).toBeNull();
  });
});

describe("isClockTime", () => {
  it("accepts a 24-hour wall clock", () => {
    for (const t of ["00:00", "07:00", "13:45", "23:59"]) {
      expect(isClockTime(t), t).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const t of ["24:00", "7:00", "07:60", "0700", "7pm", "", "07:0"]) {
      expect(isClockTime(t), t).toBe(false);
    }
  });
});

describe("renderResult", () => {
  it("marks success and failure differently", () => {
    expect(renderResult(ok("done"), "#00e5ff")).toContain("✓");
    expect(renderResult(fail("nope"), "#00e5ff")).toContain("✗");
  });

  it("paints success with the live accent", () => {
    expect(renderResult(ok("done"), "#00e5ff")).toContain("[38;2;0;229;255m");
  });

  it("paints failure red whatever the accent is", () => {
    expect(renderResult(fail("nope"), "#00e5ff")).toContain("[38;2;255;77;106m");
  });

  it("falls back to plain green when the accent is unreadable", () => {
    // The token is read live from CSS and can be a name or a gradient.
    for (const accent of ["", "rebeccapurple", "#fff", "not a colour"]) {
      expect(renderResult(ok("done"), accent), accent).toContain("[32m");
    }
  });

  it("starts and ends on its own line", () => {
    // The shell's prompt is already on the current line, and the next one has
    // to start clean.
    const out = renderResult(ok("done"), "#00e5ff");
    expect(out.startsWith("\r\n")).toBe(true);
    expect(out.endsWith("\r\n")).toBe(true);
  });

  it("includes the message", () => {
    expect(renderResult(ok("note “x” created"), "#00e5ff")).toContain("note “x” created");
  });
});
