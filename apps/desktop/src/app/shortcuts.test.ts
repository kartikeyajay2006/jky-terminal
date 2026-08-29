import { describe, expect, it } from "vitest";
import { isAppShortcut } from "./shortcuts";

function key(init: Partial<KeyboardEventInit> & { key: string }): KeyboardEvent {
  return new KeyboardEvent("keydown", init);
}

describe("what the app claims", () => {
  it("claims the palette", () => {
    expect(isAppShortcut(key({ key: "k", ctrlKey: true }))).toBe(true);
    expect(isAppShortcut(key({ key: "k", metaKey: true }))).toBe(true);
  });

  it("claims the tab shortcuts", () => {
    for (const k of ["t", "w", "Tab"]) {
      expect(isAppShortcut(key({ key: k, ctrlKey: true })), k).toBe(true);
    }
  });

  it("claims find", () => {
    expect(isAppShortcut(key({ key: "f", ctrlKey: true }))).toBe(true);
  });

  it("claims the tab numbers", () => {
    for (const n of ["1", "5", "9"]) {
      expect(isAppShortcut(key({ key: n, ctrlKey: true })), n).toBe(true);
    }
  });

  it("claims copy and paste only in their shifted form", () => {
    // Unshifted Ctrl+C is interrupt and belongs to the shell. Taking it would
    // make the terminal unusable.
    expect(isAppShortcut(key({ key: "C", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isAppShortcut(key({ key: "V", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isAppShortcut(key({ key: "c", ctrlKey: true }))).toBe(false);
    expect(isAppShortcut(key({ key: "v", ctrlKey: true }))).toBe(false);
  });

  it("is not case-sensitive, so caps lock does not break a shortcut", () => {
    expect(isAppShortcut(key({ key: "K", ctrlKey: true }))).toBe(true);
    expect(isAppShortcut(key({ key: "T", ctrlKey: true }))).toBe(true);
  });
});

describe("what the app leaves alone", () => {
  it("never claims an unmodified key", () => {
    // A shell is the one place where every keystroke is meaningful, so an
    // unmodified key must always reach it.
    for (const k of ["k", "t", "w", "f", "1", "a", "Enter", " ", "ArrowUp"]) {
      expect(isAppShortcut(key({ key: k })), k).toBe(false);
    }
  });

  it("leaves the shell's own control keys alone", () => {
    // Ctrl+C interrupt, Ctrl+D EOF, Ctrl+Z suspend, Ctrl+L clear, Ctrl+R
    // search, Ctrl+A and Ctrl+E line movement.
    for (const k of ["c", "d", "z", "l", "r", "a", "e", "u", "p", "n"]) {
      expect(isAppShortcut(key({ key: k, ctrlKey: true })), `Ctrl+${k}`).toBe(false);
    }
  });

  it("leaves Alt combinations alone", () => {
    // Alt+B and Alt+F move by word in a shell.
    expect(isAppShortcut(key({ key: "f", ctrlKey: true, altKey: true }))).toBe(false);
    expect(isAppShortcut(key({ key: "b", altKey: true }))).toBe(false);
  });

  it("does not claim a shifted key it has no binding for", () => {
    expect(isAppShortcut(key({ key: "T", ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isAppShortcut(key({ key: "K", ctrlKey: true, shiftKey: true }))).toBe(false);
  });

  it("does not claim Ctrl+0, which is not a tab", () => {
    expect(isAppShortcut(key({ key: "0", ctrlKey: true }))).toBe(false);
  });
});
