import { describe, expect, it } from "vitest";
import { overrideBytes } from "./inputKeys";

const down = (key: string, mods: Partial<KeyboardEventInit> = {}) =>
  new KeyboardEvent("keydown", { key, ...mods });

describe("overrideBytes", () => {
  it("gives Shift+Enter a byte of its own", () => {
    // The whole point: a terminal sends the same byte for both, so a
    // multi-line prompt submits itself halfway through.
    expect(overrideBytes(down("Enter", { shiftKey: true }))).toBe("\n");
  });

  it("leaves plain Enter alone", () => {
    // Enter still runs the command. Rewriting it would be a terminal you
    // cannot use a shell in.
    expect(overrideBytes(down("Enter"))).toBeNull();
  });

  it("leaves the other Enters to the programs that bind them", () => {
    // Ctrl+Enter and Alt+Enter mean things in real editors and REPLs.
    expect(overrideBytes(down("Enter", { ctrlKey: true }))).toBeNull();
    expect(overrideBytes(down("Enter", { altKey: true }))).toBeNull();
    expect(overrideBytes(down("Enter", { metaKey: true }))).toBeNull();
    expect(overrideBytes(down("Enter", { shiftKey: true, ctrlKey: true }))).toBeNull();
  });

  it("overrides nothing else at all", () => {
    for (const key of ["a", "Tab", "Escape", "ArrowUp", " ", "Backspace"]) {
      expect(overrideBytes(down(key)), key).toBeNull();
      expect(overrideBytes(down(key, { shiftKey: true })), `Shift+${key}`).toBeNull();
    }
  });

  it("answers only to a key going down", () => {
    // Acting on keyup as well would send the newline twice.
    expect(overrideBytes(new KeyboardEvent("keyup", { key: "Enter", shiftKey: true }))).toBeNull();
  });
});
