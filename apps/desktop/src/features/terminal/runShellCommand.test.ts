import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __setPlatformForTests, createWebPlatform } from "../../platform";
import { useDashboard } from "../dashboard/dashboardStore";
import { useNav } from "../../app/navStore";
import { runShellCommand } from "./runShellCommand";

/**
 * These run against the real store through the web platform, not a mock of
 * it. The point of routing shell writes through `useDashboard` is that a note
 * written from the terminal is the same note the panel shows, and a test
 * against a fake store would not be able to tell.
 */
beforeEach(async () => {
  localStorage.clear();
  __setPlatformForTests(createWebPlatform());
  useDashboard.setState({
    notes: [],
    todos: [],
    events: [],
    reminders: [],
    loaded: true,
    errors: {},
  });
});

afterEach(() => {
  __setPlatformForTests(null);
  localStorage.clear();
});

const run = runShellCommand;
const notes = () => useDashboard.getState().notes;
const todos = () => useDashboard.getState().todos;
const reminders = () => useDashboard.getState().reminders;

describe("notes", () => {
  it("creates one and shows it in the store the panel reads", async () => {
    const result = await run({ verb: "note.new", args: ["Shopping", "list"] });

    expect(result.ok).toBe(true);
    expect(notes()).toHaveLength(1);
    expect(notes()[0].title).toBe("Shopping list");
    expect(notes()[0].body).toBe("");
  });

  it("refuses a note with no title", async () => {
    const result = await run({ verb: "note.new", args: ["   "] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("usage:");
    expect(notes()).toHaveLength(0);
  });

  it("appends a line rather than replacing the body", async () => {
    // A command that discarded the body the moment you added a line to it
    // would be a trap, and the terminal has no undo.
    await run({ verb: "note.new", args: ["Log"] });
    await run({ verb: "note.write", args: ["1", "first"] });
    await run({ verb: "note.write", args: ["1", "second"] });

    expect(notes()[0].body).toBe("first\nsecond");
  });

  it("writes the first line without a leading newline", async () => {
    await run({ verb: "note.new", args: ["Log"] });
    await run({ verb: "note.write", args: ["1", "first"] });

    expect(notes()[0].body).toBe("first");
  });

  it("keeps a written line's own spacing", async () => {
    await run({ verb: "note.new", args: ["Log"] });
    await run({ verb: "note.write", args: ["1", "a", "b", "c"] });

    expect(notes()[0].body).toBe("a b c");
  });

  it("renames without touching the body", async () => {
    await run({ verb: "note.new", args: ["Old"] });
    await run({ verb: "note.write", args: ["1", "kept"] });
    const result = await run({ verb: "note.rename", args: ["1", "New", "name"] });

    expect(result.ok).toBe(true);
    expect(notes()[0].title).toBe("New name");
    expect(notes()[0].body).toBe("kept");
  });

  it("deletes the one the number points at", async () => {
    await run({ verb: "note.new", args: ["First"] });
    await run({ verb: "note.new", args: ["Second"] });
    const result = await run({ verb: "note.rm", args: ["1"] });

    expect(result.ok).toBe(true);
    expect(notes().map((n) => n.title)).toEqual(["Second"]);
  });

  it("says which listing to check when the number is wrong", async () => {
    const result = await run({ verb: "note.write", args: ["9", "text"] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("jky notes");
  });

  it("refuses to write an empty line", async () => {
    await run({ verb: "note.new", args: ["Log"] });
    const result = await run({ verb: "note.write", args: ["1", "  "] });

    expect(result.ok).toBe(false);
    expect(notes()[0].body).toBe("");
  });

  it("refuses to rename to nothing", async () => {
    await run({ verb: "note.new", args: ["Keep"] });
    const result = await run({ verb: "note.rename", args: ["1", " "] });

    expect(result.ok).toBe(false);
    expect(notes()[0].title).toBe("Keep");
  });
});

describe("todos", () => {
  it("adds one, not done", async () => {
    const result = await run({ verb: "todo.add", args: ["Buy", "milk"] });

    expect(result.ok).toBe(true);
    expect(todos()[0].text).toBe("Buy milk");
    expect(todos()[0].done).toBe(false);
  });

  it("ticks and unticks the same one", async () => {
    await run({ verb: "todo.add", args: ["Buy milk"] });

    await run({ verb: "todo.done", args: ["1"] });
    expect(todos()[0].done).toBe(true);

    await run({ verb: "todo.undone", args: ["1"] });
    expect(todos()[0].done).toBe(false);
  });

  it("keeps a ticked todo on the list", async () => {
    // Finishing something is not the same as removing it, and the store's
    // rule is that nothing goes until the user says so.
    await run({ verb: "todo.add", args: ["Buy milk"] });
    await run({ verb: "todo.done", args: ["1"] });

    expect(todos()).toHaveLength(1);
  });

  it("deletes when asked to", async () => {
    await run({ verb: "todo.add", args: ["Buy milk"] });
    const result = await run({ verb: "todo.rm", args: ["1"] });

    expect(result.ok).toBe(true);
    expect(todos()).toHaveLength(0);
  });

  it("refuses an empty todo", async () => {
    const result = await run({ verb: "todo.add", args: [] });

    expect(result.ok).toBe(false);
    expect(todos()).toHaveLength(0);
  });
});

describe("reminders", () => {
  it("sets one at a wall-clock time", async () => {
    const result = await run({
      verb: "reminder.add",
      args: ["07:00", "Go for a run"],
    });

    expect(result.ok).toBe(true);
    expect(reminders()[0]).toMatchObject({
      at: "07:00",
      text: "Go for a run",
      done: false,
    });
  });

  it("refuses a time that is not HH:MM", async () => {
    for (const at of ["7:00", "25:00", "0700", "morning"]) {
      const result = await run({ verb: "reminder.add", args: [at, "text"] });
      expect(result.ok, at).toBe(false);
    }
    expect(reminders()).toHaveLength(0);
  });

  it("refuses a reminder with no text", async () => {
    const result = await run({ verb: "reminder.add", args: ["07:00"] });

    expect(result.ok).toBe(false);
    expect(reminders()).toHaveLength(0);
  });

  it("ticks the one the listing prints first, not the one added first", async () => {
    // The listing is in order of the day. If the handle resolved in insertion
    // order instead, `jky reminder done 1` would tick the wrong reminder —
    // and it would look like it had worked.
    await run({ verb: "reminder.add", args: ["18:00", "Evening"] });
    await run({ verb: "reminder.add", args: ["07:00", "Morning"] });

    const result = await run({ verb: "reminder.done", args: ["1"] });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("Morning");
    expect(reminders().find((r) => r.text === "Morning")?.done).toBe(true);
    expect(reminders().find((r) => r.text === "Evening")?.done).toBe(false);
  });

  it("deletes in that same order", async () => {
    await run({ verb: "reminder.add", args: ["18:00", "Evening"] });
    await run({ verb: "reminder.add", args: ["07:00", "Morning"] });

    await run({ verb: "reminder.rm", args: ["1"] });

    expect(reminders().map((r) => r.text)).toEqual(["Evening"]);
  });

  it("unticks", async () => {
    await run({ verb: "reminder.add", args: ["07:00", "Run"] });
    await run({ verb: "reminder.done", args: ["1"] });
    await run({ verb: "reminder.undone", args: ["1"] });

    expect(reminders()[0].done).toBe(false);
  });
});

describe("the app itself", () => {
  it("changes the theme and remembers it", async () => {
    const result = await run({ verb: "theme", args: ["nord"] });

    expect(result.ok).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("nord");
  });

  it("takes a theme's label as well as its id", async () => {
    expect((await run({ verb: "theme", args: ["Nord"] })).ok).toBe(true);
  });

  it("lists the themes when given one that does not exist", async () => {
    const result = await run({ verb: "theme", args: ["taupe"] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("nord");
  });

  it("names the themes when given none", async () => {
    const result = await run({ verb: "theme", args: [] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("usage:");
  });

  it("goes to a section", async () => {
    const result = await run({ verb: "open", args: ["games"] });

    expect(result.ok).toBe(true);
    expect(useNav.getState().pending).toEqual({ section: "games", panel: undefined });
  });

  it("goes to a panel inside a section", async () => {
    await run({ verb: "open", args: ["dashboard", "Calendar"] });

    expect(useNav.getState().pending).toEqual({
      section: "dashboard",
      panel: "calendar",
    });
  });

  it("refuses a section that does not exist", async () => {
    const result = await run({ verb: "open", args: ["kitchen"] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("usage:");
  });
});

describe("anything else", () => {
  it("points at the command list rather than guessing", async () => {
    const result = await run({ verb: "note.burn", args: ["1"] });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("jky commands");
  });
});
