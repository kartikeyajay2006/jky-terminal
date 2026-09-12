import type { Binding, Conflict, Keyboard } from "./types";

/**
 * The default keymap, for the browser build.
 *
 * It exists twice: here, and in `crates/jky-keys/src/map.rs`, which the
 * desktop build actually uses. Two copies drift silently, so
 * `keymap.parity.test.ts` reads the Rust source and compares — the same
 * blunt instrument the provider catalogue is kept honest with.
 */
export const DEFAULT_BINDINGS: ReadonlyArray<Omit<Binding, "chord" | "custom">> = [
  { action: "palette-toggle", label: "Command palette", group: "App", default_chord: "Ctrl+K" },
  {
    action: "rail-toggle",
    label: "Show or hide the sidebar",
    group: "App",
    default_chord: "Ctrl+B",
  },
  {
    action: "hud-toggle",
    label: "Focus mode",
    group: "App",
    default_chord: "Ctrl+Shift+B",
  },
  { action: "tab-new", label: "New terminal tab", group: "Tabs", default_chord: "Ctrl+T" },
  { action: "tab-close", label: "Close tab", group: "Tabs", default_chord: "Ctrl+W" },
  { action: "tab-next", label: "Next tab", group: "Tabs", default_chord: "Ctrl+Tab" },
  { action: "terminal-find", label: "Find in terminal", group: "Terminal", default_chord: "Ctrl+F" },
  { action: "terminal-copy", label: "Copy", group: "Terminal", default_chord: "Ctrl+Shift+C" },
  { action: "terminal-paste", label: "Paste", group: "Terminal", default_chord: "Ctrl+Shift+V" },
  { action: "pane-split-right", label: "Split terminal right", group: "Panes", default_chord: "Ctrl+Shift+T" },
  { action: "pane-split-down", label: "Split terminal down", group: "Panes", default_chord: "Ctrl+Shift+D" },
  { action: "pane-close", label: "Close pane", group: "Panes", default_chord: "Ctrl+Shift+W" },
  { action: "pane-focus-left", label: "Focus pane left", group: "Panes", default_chord: "Ctrl+Shift+ArrowLeft" },
  { action: "pane-focus-right", label: "Focus pane right", group: "Panes", default_chord: "Ctrl+Shift+ArrowRight" },
  { action: "pane-focus-up", label: "Focus pane up", group: "Panes", default_chord: "Ctrl+Shift+ArrowUp" },
  { action: "pane-focus-down", label: "Focus pane down", group: "Panes", default_chord: "Ctrl+Shift+ArrowDown" },
];

/** The default keyboard: nothing customised, nothing colliding. */
export function defaultKeyboard(): Keyboard {
  return {
    bindings: DEFAULT_BINDINGS.map((b) => ({ ...b, chord: b.default_chord, custom: false })),
    conflicts: [],
  };
}

export function conflictsIn(bindings: Binding[]): Conflict[] {
  const byChord = new Map<string, string[]>();
  for (const binding of bindings) {
    byChord.set(binding.chord, [...(byChord.get(binding.chord) ?? []), binding.label]);
  }
  return [...byChord.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([chord, actions]) => ({ chord, actions }));
}

/**
 * Turn a keystroke into the chord text `jky-keys` would have written.
 *
 * `Ctrl` covers Cmd as well, which is what every shortcut in this app has
 * always accepted and what the Rust parser folds them to — so a keymap made
 * on a Mac means the same thing on a PC.
 *
 * Returns null for a modifier pressed on its own: holding Ctrl is not a
 * chord, and treating it as one would fire a binding on the way to another.
 */
export function chordOf(e: KeyboardEvent): string | null {
  if (["Control", "Meta", "Shift", "Alt"].includes(e.key)) return null;

  const ctrl = e.ctrlKey || e.metaKey;
  if (!ctrl && !e.altKey) return null;

  const key =
    e.key === " " ? "Space" : e.key.length === 1 ? e.key.toUpperCase() : e.key;

  return `${ctrl ? "Ctrl+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${key}`;
}
