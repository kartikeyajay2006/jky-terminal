import { create } from "zustand";
import { getPlatform } from "../platform";

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

const TABS_KEY = "jky.tabs";

let counter = 0;
const nextId = () => `tab-${++counter}`;

/**
 * What came back from last time.
 *
 * Ids are persisted, not regenerated, because each one is the key its
 * scrollback is stored under — a tab that came back with a fresh id would
 * find an empty terminal and leave the old output orphaned on disk.
 */
function restore(): Pick<TabState, "tabs" | "activeId"> {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (!raw) return { tabs: [], activeId: null };

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return { tabs: [], activeId: null };

    const tabs: Tab[] = [];
    for (const item of parsed) {
      if (typeof item !== "object" || item === null) continue;
      const t = item as Record<string, unknown>;
      // Only terminals are restored. `providers` tabs hold no state worth
      // bringing back and would reopen a settings pane nobody asked for.
      if (typeof t.id !== "string" || t.kind !== "terminal") continue;
      if (typeof t.title !== "string") continue;
      tabs.push({ id: t.id, kind: "terminal", title: t.title });

      // Keep the counter ahead of anything restored, or the next new tab
      // reuses an id and inherits a stranger's scrollback.
      const n = Number(t.id.replace(/^tab-/, ""));
      if (Number.isFinite(n) && n > counter) counter = n;
    }

    return { tabs, activeId: tabs[0]?.id ?? null };
  } catch {
    // Storage can throw outright in a private window; starting fresh is fine.
    return { tabs: [], activeId: null };
  }
}

function persist(tabs: Tab[]): void {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    // Tabs lost on next launch, app fine.
  }
}

export const useTabs = create<TabState>((set, get) => ({
  ...restore(),

  openTab: (kind, title) => {
    const id = nextId();
    set((s) => {
      const tabs = [...s.tabs, { id, kind, title }];
      persist(tabs);
      return { tabs, activeId: id };
    });
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

    persist(remaining);
    // Closing a tab is the user removing it, so its saved output goes too.
    // Done here rather than in the tab bar because there are two ways to
    // close one — the glyph and the Delete key — and only one event.
    void getPlatform().scrollback.forget(id).catch(() => {});
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
