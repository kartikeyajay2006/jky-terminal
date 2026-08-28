import { create } from "zustand";
import { loadDismissed, loadTrayOpen, pruneDismissed, saveDismissed, saveTrayOpen } from "./trayState";

/**
 * What the notification centre and the heads-up banners agree on.
 *
 * Shared through a store rather than props because the two are rendered
 * side by side and must not disagree: dismissing a banner has to remove the
 * same row from the centre, and vice versa.
 */
interface NotificationState {
  /** Is the notification centre showing? Remembered across launches. */
  open: boolean;
  /** Keys the user has waved away. Remembered across launches. */
  dismissed: Set<string>;
  /**
   * Keys whose banner has already had its moment.
   *
   * Session-only on purpose: a banner is an interruption, and one that
   * survived a restart could never fire again for something still genuinely
   * due. Re-showing on launch is what a phone does when you unlock it.
   */
  seen: Set<string>;
  /** The shared clock, ticked in one place so both views agree on "now". */
  now: Date;

  setOpen: (open: boolean) => void;
  tick: () => void;
  dismiss: (key: string) => void;
  dismissMany: (keys: string[]) => void;
  markSeen: (key: string) => void;
  /** Forget dismissals for anything no longer due, so the set cannot grow forever. */
  prune: (currentKeys: Set<string>) => void;
}

export const useNotifications = create<NotificationState>((set) => ({
  open: loadTrayOpen(),
  dismissed: loadDismissed(),
  seen: new Set(),
  now: new Date(),

  setOpen(open) {
    saveTrayOpen(open);
    set({ open });
  },

  tick() {
    set({ now: new Date() });
  },

  dismiss(key) {
    set((s) => {
      const dismissed = new Set(s.dismissed).add(key);
      saveDismissed(dismissed);
      // Dismissing also spends the banner: a row waved away must not pop
      // straight back up as a heads-up.
      return { dismissed, seen: new Set(s.seen).add(key) };
    });
  },

  dismissMany(keys) {
    set((s) => {
      const dismissed = new Set(s.dismissed);
      const seen = new Set(s.seen);
      for (const k of keys) {
        dismissed.add(k);
        seen.add(k);
      }
      saveDismissed(dismissed);
      return { dismissed, seen };
    });
  },

  markSeen(key) {
    set((s) => (s.seen.has(key) ? s : { seen: new Set(s.seen).add(key) }));
  },

  prune(currentKeys) {
    set((s) => {
      const dismissed = pruneDismissed(s.dismissed, currentKeys);
      if (dismissed.size === s.dismissed.size) return s;
      saveDismissed(dismissed);
      return { dismissed };
    });
  },
}));
