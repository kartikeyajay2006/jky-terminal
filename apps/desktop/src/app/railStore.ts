import { create } from "zustand";

const KEY = "jky.rail.collapsed";

interface RailState {
  collapsed: boolean;
  toggle: () => void;
  set: (collapsed: boolean) => void;
}

/**
 * Whether the rail is showing its labels.
 *
 * Remembered, because it is a decision about how you like to work rather than
 * about what you are doing right now — and having to make it again on every
 * launch is how a preference becomes an annoyance.
 */
function restore(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    // Storage can throw outright in a private window. Open is the right
    // answer when we cannot know: a rail nobody asked to close should not be.
    return false;
  }
}

function remember(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, String(collapsed));
  } catch {
    // Forgotten by the next launch, app fine.
  }
}

export const useRail = create<RailState>((set, get) => ({
  collapsed: restore(),

  toggle: () => {
    const collapsed = !get().collapsed;
    remember(collapsed);
    set({ collapsed });
  },

  set: (collapsed) => {
    remember(collapsed);
    set({ collapsed });
  },
}));
