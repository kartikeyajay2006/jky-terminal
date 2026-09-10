import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionFor, chordFor, useKeymap } from "./keymapStore";
import { chordOf, defaultKeyboard } from "../platform/keymap";

const press = (key: string, mods: Partial<KeyboardEvent> = {}) =>
  new KeyboardEvent("keydown", { key, ...mods });

function reseed() {
  const board = defaultKeyboard();
  useKeymap.setState({
    bindings: board.bindings,
    conflicts: [],
    byChord: new Map(board.bindings.map((b) => [b.chord, b.action])),
    error: null,
  });
}

describe("reading a keystroke", () => {
  beforeEach(reseed);

  it("finds the action a chord is bound to", () => {
    expect(actionFor(press("t", { ctrlKey: true }))).toBe("tab-new");
    expect(actionFor(press("T", { ctrlKey: true, shiftKey: true }))).toBe("pane-split-right");
    expect(actionFor(press("D", { ctrlKey: true, shiftKey: true }))).toBe("pane-split-down");
  });

  it("treats Cmd as Ctrl, so a keymap means the same on either machine", () => {
    expect(actionFor(press("t", { metaKey: true }))).toBe("tab-new");
  });

  it("says nothing for an unmodified key, which belongs to the shell", () => {
    expect(actionFor(press("t"))).toBeNull();
    expect(actionFor(press("D", { shiftKey: true }))).toBeNull();
  });

  it("says nothing for a modifier held on its own", () => {
    // Otherwise a binding fires on the way to the chord that contains it.
    expect(actionFor(press("Control", { ctrlKey: true }))).toBeNull();
    expect(actionFor(press("Shift", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it("names arrows and space the way the keymap spells them", () => {
    expect(chordOf(press("ArrowLeft", { ctrlKey: true, shiftKey: true }))).toBe(
      "Ctrl+Shift+ArrowLeft",
    );
    expect(chordOf(press(" ", { ctrlKey: true }))).toBe("Ctrl+Space");
  });

  it("follows a rebind", () => {
    useKeymap.setState({ byChord: new Map([["Ctrl+Alt+2", "pane-split-right"]]) });
    expect(actionFor(press("2", { ctrlKey: true, altKey: true }))).toBe("pane-split-right");
    expect(actionFor(press("T", { ctrlKey: true, shiftKey: true }))).toBeNull();
  });
});

describe("what a menu prints", () => {
  beforeEach(reseed);

  it("shows what is bound now, not what shipped", () => {
    expect(chordFor("terminal-find")).toBe("Ctrl+F");
    useKeymap.setState({
      bindings: [
        {
          action: "terminal-find",
          label: "Find in terminal",
          group: "Terminal",
          chord: "Ctrl+Alt+F",
          default_chord: "Ctrl+F",
          custom: true,
        },
      ],
    });
    expect(chordFor("terminal-find")).toBe("Ctrl+Alt+F");
  });

  it("says nothing for an action nobody bound", () => {
    expect(chordFor("make-the-tea")).toBe("");
  });
});

describe("loading", () => {
  beforeEach(reseed);

  it("keeps the defaults working when the keymap cannot be read", async () => {
    // The gap before the file arrives is a window with working shortcuts
    // rather than a window with none.
    const { getPlatform } = await import("../platform");
    vi.spyOn(getPlatform().keys, "list").mockRejectedValueOnce(new Error("disk on fire"));

    await useKeymap.getState().load();
    expect(useKeymap.getState().error).toContain("disk on fire");
    expect(actionFor(press("t", { ctrlKey: true }))).toBe("tab-new");
  });

  it("takes the first of two actions sharing a chord rather than firing both", () => {
    useKeymap.setState({
      byChord: new Map(),
      bindings: [
        { action: "tab-new", label: "a", group: "Tabs", chord: "Ctrl+J", default_chord: "Ctrl+T", custom: true },
        { action: "tab-close", label: "b", group: "Tabs", chord: "Ctrl+J", default_chord: "Ctrl+W", custom: true },
      ],
    });
    // Rebuild the index the way the store does.
    const map = new Map<string, string>();
    for (const b of useKeymap.getState().bindings) if (!map.has(b.chord)) map.set(b.chord, b.action);
    useKeymap.setState({ byChord: map });

    expect(actionFor(press("j", { ctrlKey: true }))).toBe("tab-new");
  });
});
