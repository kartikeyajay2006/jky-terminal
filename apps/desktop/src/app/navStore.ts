import { create } from "zustand";

/**
 * Where the palette is asking the app to go.
 *
 * The same pattern as `askStore` and the games' `openStore`, and for the same
 * reason: the palette is nowhere near the panel it wants to open, and the
 * panels keep their own local state. A pending request is how the two talk
 * without either importing the other.
 */
export interface NavTarget {
  /** A rail destination: dashboard, terminal, assistant, games, settings. */
  section: string;
  /** A panel inside that section, when the caller wants a specific one. */
  panel?: string;
}

interface NavState {
  pending: NavTarget | null;
  go: (section: string, panel?: string) => void;
  /** Take the request, clearing it so one command navigates once. */
  take: () => NavTarget | null;
  /**
   * Read the pending panel for a section without clearing the request.
   *
   * A section and its panel are taken by two different components — App
   * switches the section, the section picks the panel — and whichever ran
   * first would otherwise clear the request out from under the other.
   */
  takePanel: (section: string) => string | null;
}

export const useNav = create<NavState>((set, get) => ({
  pending: null,

  go: (section, panel) => set({ pending: { section, panel } }),

  take: () => {
    const { pending } = get();
    if (pending !== null) set({ pending: null });
    return pending;
  },

  takePanel: (section) => {
    const { pending } = get();
    if (!pending || pending.section !== section || !pending.panel) return null;
    set({ pending: { section, panel: undefined } });
    return pending.panel;
  },
}));
