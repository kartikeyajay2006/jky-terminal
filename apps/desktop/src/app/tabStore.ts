import { create } from "zustand";

export type TabKind = "terminal" | "providers";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
}

interface TabState {
  tabs: Tab[];
  activeId: string | null;
  openTab: (kind: TabKind, title: string) => string;
  closeTab: (id: string) => void;
  focusTab: (id: string) => void;
  nextTab: () => void;
}

let counter = 0;
const nextId = () => `tab-${++counter}`;

export const useTabs = create<TabState>((set, get) => ({
  tabs: [],
  activeId: null,

  openTab: (kind, title) => {
    const id = nextId();
    set((s) => ({ tabs: [...s.tabs, { id, kind, title }], activeId: id }));
    return id;
  },

  closeTab: (id) => {
    const { tabs, activeId } = get();
    const index = tabs.findIndex((t) => t.id === id);
    if (index === -1) return;

    const remaining = tabs.filter((t) => t.id !== id);
    // Closing the focused tab moves focus to its left neighbour, or the new
    // first tab if it was leftmost. Closing any other tab leaves focus alone.
    const nextActive =
      activeId === id ? (remaining[index - 1] ?? remaining[0])?.id ?? null : activeId;

    set({ tabs: remaining, activeId: nextActive });
  },

  focusTab: (id) => {
    if (get().tabs.some((t) => t.id === id)) set({ activeId: id });
  },

  nextTab: () => {
    const { tabs, activeId } = get();
    if (tabs.length === 0) return;
    const index = tabs.findIndex((t) => t.id === activeId);
    set({ activeId: tabs[(index + 1) % tabs.length].id });
  },
}));
