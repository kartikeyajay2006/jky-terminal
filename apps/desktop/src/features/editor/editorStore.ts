import { create } from "zustand";
import { getPlatform } from "../../platform";

/** One file open in the editor. */
export interface OpenFile {
  /** Which folder it came from. Two folders may hold the same relative path. */
  root: string;
  path: string;
  /** As it was read, so "changed" is a comparison rather than a guess. */
  saved: string;
  text: string;
}

/** A file's identity across folders. */
export const keyOf = (root: string, path: string) => `${root} ${path}`;
export const idOf = (file: OpenFile) => keyOf(file.root, file.path);
export const isDirty = (file: OpenFile) => file.text !== file.saved;

interface EditorState {
  open: OpenFile[];
  active: string | null;

  /** Read a file in, or bring it to the front if it is already open. */
  openFile: (root: string, path: string) => Promise<void>;
  focus: (id: string) => void;
  edit: (id: string, text: string) => void;
  /** Write one file. Answers whether it reached the disk. */
  save: (id: string) => Promise<boolean>;
  /** Take a file off screen. Asks nothing — the caller has already decided. */
  drop: (id: string) => void;
  /** Take every file from one folder off screen. */
  dropFolder: (root: string) => void;
  /** Follow a rename, so the tab stays on the file it was on. */
  renamed: (root: string, from: string, to: string) => void;
  /** The last thing that went wrong, or null. */
  error: string | null;
  clearError: () => void;
}

/**
 * Which files are open, and what is in them.
 *
 * In a store rather than in the Editor component, because the component is
 * unmounted whenever you look at anything else — CodeMirror owns a lot of DOM
 * and leaving it mounted behind a section nobody is looking at is a document
 * tree kept alive for nothing. When the text lived there too, switching to
 * the terminal and back threw away everything unsaved.
 *
 * So the editor is a view of this, and leaving the section costs the scroll
 * position and nothing else.
 */
export const useEditor = create<EditorState>((set, get) => ({
  open: [],
  active: null,
  error: null,

  clearError: () => set({ error: null }),

  openFile: async (root, path) => {
    const id = keyOf(root, path);
    if (get().open.some((f) => idOf(f) === id)) {
      set({ active: id });
      return;
    }

    try {
      const text = await getPlatform().files.read(root, path);
      set((s) => ({
        open: [...s.open, { root, path, saved: text, text }],
        active: id,
        error: null,
      }));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  focus: (id) => {
    if (get().open.some((f) => idOf(f) === id)) set({ active: id });
  },

  edit: (id, text) => {
    set((s) => ({ open: s.open.map((f) => (idOf(f) === id ? { ...f, text } : f)) }));
  },

  save: async (id) => {
    const file = get().open.find((f) => idOf(f) === id);
    if (!file) return false;

    try {
      await getPlatform().files.write(file.root, file.path, file.text);
      // What is on disk is now what is on screen, so the dot goes out.
      set((s) => ({
        open: s.open.map((f) => (idOf(f) === id ? { ...f, saved: f.text } : f)),
        error: null,
      }));
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },

  drop: (id) => {
    set((s) => {
      const open = s.open.filter((f) => idOf(f) !== id);
      // Focus falls back to whatever is now last, so closing the front tab
      // never leaves the editor pointing at nothing while files are open.
      const active =
        s.active === id ? (open.length > 0 ? idOf(open[open.length - 1]) : null) : s.active;
      return { open, active };
    });
  },

  dropFolder: (root) => {
    set((s) => {
      const open = s.open.filter((f) => f.root !== root);
      const stillThere = open.some((f) => idOf(f) === s.active);
      return {
        open,
        active: stillThere ? s.active : (open.length > 0 ? idOf(open[open.length - 1]) : null),
      };
    });
  },

  renamed: (root, from, to) => {
    set((s) => {
      const wasActive = s.active === keyOf(root, from);
      const open = s.open.map((f) =>
        f.root === root && f.path === from ? { ...f, path: to } : f,
      );
      return { open, active: wasActive ? keyOf(root, to) : s.active };
    });
  },
}));

/** How many open files have changes that are not on disk. */
export function unsavedCount(): number {
  return useEditor.getState().open.filter(isDirty).length;
}
