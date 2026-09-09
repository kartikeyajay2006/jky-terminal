import { create } from "zustand";
import { chordOf, defaultKeyboard } from "../platform/keymap";
import { getPlatform } from "../platform";
import type { Binding, Conflict } from "../platform";

interface KeymapState {
  bindings: Binding[];
  conflicts: Conflict[];
  /** Chord text to action id, rebuilt whenever the bindings change. */
  byChord: Map<string, string>;
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  bind: (action: string, chord: string) => Promise<void>;
  reset: (action: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

const index = (bindings: Binding[]): Map<string, string> => {
  const map = new Map<string, string>();
  // First wins. Two actions can only share a chord in a hand-edited file, and
  // the panel says so; firing both would be worse than firing the first.
  for (const binding of bindings) {
    if (!map.has(binding.chord)) map.set(binding.chord, binding.action);
  }
  return map;
};

/**
 * What every key is bound to, as the window sees it.
 *
 * Seeded with the defaults rather than left empty. The keymap arrives over
 * IPC one tick after the app mounts, and a window with no bindings in that
 * gap is a window where Ctrl+T does nothing — which is exactly when someone
 * would press it.
 */
export const useKeymap = create<KeymapState>((set) => ({
  ...(() => {
    const board = defaultKeyboard();
    return { bindings: board.bindings, conflicts: board.conflicts, byChord: index(board.bindings) };
  })(),
  loaded: false,
  error: null,

  load: async () => {
    try {
      const board = await getPlatform().keys.list();
      set({
        bindings: board.bindings,
        conflicts: board.conflicts,
        byChord: index(board.bindings),
        loaded: true,
        error: null,
      });
    } catch (e) {
      // The defaults are already in place, so the app stays usable and the
      // panel says what went wrong rather than showing an empty table.
      set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  bind: async (action, chord) => {
    const board = await getPlatform().keys.bind(action, chord);
    set({ bindings: board.bindings, conflicts: board.conflicts, byChord: index(board.bindings) });
  },

  reset: async (action) => {
    const board = await getPlatform().keys.reset(action);
    set({ bindings: board.bindings, conflicts: board.conflicts, byChord: index(board.bindings) });
  },

  resetAll: async () => {
    const board = await getPlatform().keys.resetAll();
    set({ bindings: board.bindings, conflicts: board.conflicts, byChord: index(board.bindings) });
  },
}));

/**
 * Which action a keystroke runs, if any.
 *
 * The single place a KeyboardEvent becomes a decision. Every shortcut in the
 * app goes through here, which is what makes rebinding one actually rebind
 * it — before this, the chords were written into the components that
 * answered them and a settings panel could only have lied.
 */
export function actionFor(e: KeyboardEvent): string | null {
  const chord = chordOf(e);
  return chord ? (useKeymap.getState().byChord.get(chord) ?? null) : null;
}

/** What to print beside a menu item. Empty when the action is unbound. */
export function chordFor(action: string): string {
  return useKeymap.getState().bindings.find((b) => b.action === action)?.chord ?? "";
}
