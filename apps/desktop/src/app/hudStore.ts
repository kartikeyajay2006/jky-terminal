import { create } from "zustand";

interface HudState {
  on: boolean;
  toggle: () => void;
  leave: () => void;
}

/**
 * Focus mode: the window, minus everything that is not the work.
 *
 * The rail, the tab bar and the status bar go, and the terminal takes the
 * whole window. What stays is one small translucent readout in the corner,
 * because a mode with no way out on screen is a mode people get stuck in.
 *
 * Not remembered across launches, and that is deliberate. The rail's collapse
 * is a decision about how you like to work; this is a decision about what you
 * are doing in the next twenty minutes. Restoring it would mean launching
 * into a window with no navigation and no status bar, which to anyone who had
 * forgotten looks exactly like an app that failed to start.
 *
 * Escape does not leave it either. Escape is the single most meaningful key
 * in a terminal — a person in vim presses it a hundred times an hour — and a
 * window mode that reads it would be one that came apart the first time
 * anybody did real work inside it.
 */
export const useHud = create<HudState>((set, get) => ({
  on: false,
  toggle: () => set({ on: !get().on }),
  leave: () => set({ on: false }),
}));
