import { create } from "zustand";

const KEY = "jky.panes.dirs";

interface PaneDirs {
  /** Where each pane last was, by the key its scrollback is saved under. */
  dirs: Record<string, string>;
  remember: (pane: string, dir: string) => void;
  forget: (pane: string) => void;
  /** Drop every pane that is no longer open, so the record cannot grow for ever. */
  prune: (keep: readonly string[]) => void;
}

/**
 * Where each terminal was, so it opens there again.
 *
 * The scrollback of a pane already survives a restart, and its tab does. The
 * directory did not, so every relaunch put you back in your home directory
 * looking at the text of a session that was somewhere else entirely — which
 * is worse than having no history at all, because the history reads as
 * though it still applies.
 *
 * Kept in the window rather than in Rust because the window is where OSC 7
 * arrives: the shell reports its directory on every prompt, and this is that
 * report, remembered. Rust decides whether to honour it — a directory that
 * has since been deleted or renamed is not one to open in, and only the
 * machine can say.
 *
 * Storage can throw outright in a private window, and a terminal that will
 * not open because its last directory could not be read would be a poor
 * trade for a convenience. Every path here fails to "no memory".
 */
function restore(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    // Anything that is not a string is not a path, whatever it is.
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([, v]) => typeof v === "string" && v !== "",
      ),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

function keep(dirs: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(dirs));
  } catch {
    // Forgotten by the next launch, terminal fine.
  }
}

export const usePaneDirs = create<PaneDirs>((set, get) => ({
  dirs: restore(),

  remember: (pane, dir) => {
    if (!pane || !dir) return;
    // Written on every prompt, so the common case is that nothing changed.
    // Storing it again would be a write to disk per command.
    if (get().dirs[pane] === dir) return;
    const dirs = { ...get().dirs, [pane]: dir };
    keep(dirs);
    set({ dirs });
  },

  forget: (pane) => {
    if (!(pane in get().dirs)) return;
    const dirs = { ...get().dirs };
    delete dirs[pane];
    keep(dirs);
    set({ dirs });
  },

  prune: (open) => {
    const dirs = get().dirs;
    const kept = Object.fromEntries(Object.entries(dirs).filter(([pane]) => open.includes(pane)));
    if (Object.keys(kept).length === Object.keys(dirs).length) return;
    keep(kept);
    set({ dirs: kept });
  },
}));

/** Where a pane last was, or null when nothing is remembered for it. */
export function dirOf(pane: string | undefined): string | null {
  if (!pane) return null;
  return usePaneDirs.getState().dirs[pane] ?? null;
}
