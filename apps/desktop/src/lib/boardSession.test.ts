import { beforeEach, describe, expect, it } from "vitest";
import {
  EMPTY,
  closeIn,
  loadSession,
  openIn,
  saveSession,
  showBoard,
  type Session,
} from "./boardSession";

const exists = (id: string) => ["a", "b", "c"].includes(id);
const session = (open: string[], active: string | null): Session => ({ open, active });

describe("opening", () => {
  it("opens something and shows it", () => {
    expect(openIn(EMPTY, "a")).toEqual({ open: ["a"], active: "a" });
  });

  it("brings forward something already open rather than opening it twice", () => {
    const twice = openIn(openIn(session(["a", "b"], "b"), "a"), "a");
    expect(twice.open).toEqual(["a", "b"]);
    expect(twice.active).toBe("a");
  });

  it("shows the board again without closing anything", () => {
    expect(showBoard(session(["a", "b"], "b"))).toEqual({ open: ["a", "b"], active: null });
  });
});

describe("closing", () => {
  /*
   * Closing what you are looking at moves to a neighbour, not to the board.
   *
   * You were working in a tab; being thrown back to the grid every time you
   * finish with one is a step nobody asked for.
   */
  it("moves to a neighbour when the one showing is closed", () => {
    expect(closeIn(session(["a", "b", "c"], "b"), "b")).toEqual({
      open: ["a", "c"],
      active: "c",
    });
  });

  it("falls back to the one before it when the last is closed", () => {
    expect(closeIn(session(["a", "b"], "b"), "b")).toEqual({ open: ["a"], active: "a" });
  });

  it("leaves you where you are when you close one you are not looking at", () => {
    expect(closeIn(session(["a", "b", "c"], "a"), "c")).toEqual({
      open: ["a", "b"],
      active: "a",
    });
  });

  // Nothing left to show, so the board comes back.
  it("returns to the board when the last one closes", () => {
    expect(closeIn(session(["a"], "a"), "a")).toEqual({ open: [], active: null });
  });

  it("ignores closing something that is not open", () => {
    const before = session(["a"], "a");
    expect(closeIn(before, "z")).toEqual(before);
  });
});

describe("storage", () => {
  beforeEach(() => localStorage.clear());

  it("survives a round trip", () => {
    saveSession("k", session(["a", "b"], "b"));
    expect(loadSession("k", exists)).toEqual({ open: ["a", "b"], active: "b" });
  });

  it("starts empty when nothing is stored", () => {
    expect(loadSession("k", exists)).toEqual(EMPTY);
  });

  /*
   * A tab for something this version no longer has would open nothing, and
   * there would be no way to tell from looking at it.
   */
  it("drops what no longer exists", () => {
    saveSession("k", session(["a", "gone"], "gone"));
    expect(loadSession("k", exists)).toEqual({ open: ["a"], active: null });
  });

  it("falls back rather than breaking on nonsense", () => {
    for (const junk of ["", "not json", "[]", '{"open":"no"}', '{"open":[1,2]}']) {
      localStorage.setItem("k", junk);
      expect(loadSession("k", exists).open).toEqual([]);
    }
  });
});
