import { create } from "zustand";
import { getPlatform } from "../platform";
import {
  closeLeaf,
  focusAfterClose,
  hasLeaf,
  leaf,
  leaves,
  neighbour,
  parsePane,
  setRatio,
  splitLeaf,
  type Direction,
  type Pane,
  type Side,
} from "../features/terminal/panes/tree";

export type TabKind = "terminal" | "providers";

export interface Tab {
  id: string;
  kind: TabKind;
  title: string;
  /**
   * The terminals in this tab and the lines between them.
   *
   * A tab with one terminal is a tree with one leaf, so there is no second
   * code path for the unsplit case — the thing every tab was before splits
   * existed is just the smallest tree.
   */
  layout: Pane;
  /** Which terminal in the tree has the keyboard. Always a leaf of `layout`. */
  focusedPane: string;
  /**
   * Panes that are on another machine, by saved host id.
   *
   * A map rather than a flag on the tab: splitting a remote terminal gives
   * you a local one, which is what you want when you are looking at a server
   * and need to check something here.
   */
  remotes: Record<string, string>;
}

interface TabState {
  tabs: Tab[];
  activeId: string | null;
  openTab: (kind: TabKind, title: string) => string;
  /** A tab whose first terminal is on a saved host. */
  openRemoteTab: (hostId: string, title: string) => string;
  closeTab: (id: string) => void;
  focusTab: (id: string) => void;
  nextTab: () => void;
  /** Put a new terminal beside `paneId`, and focus it. */
  splitPane: (tabId: string, paneId: string, dir: Direction) => void;
  /** Close one terminal. The last one in a tab closes the tab. */
  closePane: (tabId: string, paneId: string) => void;
  focusPane: (tabId: string, paneId: string) => void;
  /** Move focus one pane in a direction. Does nothing at the edge. */
  movePaneFocus: (tabId: string, side: Side) => void;
  resizeSplit: (tabId: string, splitId: string, ratio: number) => void;
}

const TABS_KEY = "jky.tabs";

let counter = 0;
const nextId = () => `tab-${++counter}`;

let paneCounter = 0;
const nextPaneId = () => `pane-${++paneCounter}`;

let splitCounter = 0;
const nextSplitId = () => `split-${++splitCounter}`;

/** Every terminal on screen, across every tab. These are scrollback keys. */
export function allPaneKeys(tabs: Tab[]): string[] {
  return tabs.flatMap((t) => leaves(t.layout));
}

/**
 * Keep the id counters ahead of anything restored.
 *
 * A fresh pane that reused a saved id would open onto a stranger's
 * scrollback, which is the same bug the tab counter has always guarded
 * against — now with two more kinds of id to guard.
 */
function advanceCounters(pane: Pane): void {
  if (pane.kind === "leaf") {
    const n = Number(pane.id.replace(/^pane-/, ""));
    if (pane.id.startsWith("pane-") && Number.isFinite(n) && n > paneCounter) paneCounter = n;
    return;
  }
  const n = Number(pane.id.replace(/^split-/, ""));
  if (Number.isFinite(n) && n > splitCounter) splitCounter = n;
  advanceCounters(pane.a);
  advanceCounters(pane.b);
}

/**
 * What came back from last time.
 *
 * Ids are persisted, not regenerated, because each one is the key its
 * scrollback is stored under — a tab that came back with a fresh id would
 * find an empty terminal and leave the old output orphaned on disk.
 *
 * A tab saved before splits existed has no layout at all. It becomes a tree
 * with one leaf named after the tab, which is exactly where its scrollback
 * already is: upgrading must not cost anyone their output.
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

      const layout = parsePane(t.layout) ?? leaf(t.id);
      advanceCounters(layout);

      const focused =
        typeof t.focusedPane === "string" && hasLeaf(layout, t.focusedPane)
          ? t.focusedPane
          : leaves(layout)[0];

      // Remote panes are deliberately not restored. Bringing the app back
      // must not reconnect to somebody's production machine on its own —
      // and the session on the other side is gone regardless.
      tabs.push({
        id: t.id,
        kind: "terminal",
        title: t.title,
        layout,
        focusedPane: focused,
        remotes: {},
      });

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

/** Replace one tab, persist, and hand back the new list. */
function withTab(tabs: Tab[], tabId: string, change: (tab: Tab) => Tab): Tab[] | null {
  const index = tabs.findIndex((t) => t.id === tabId);
  if (index === -1) return null;
  const next = [...tabs];
  next[index] = change(tabs[index]);
  persist(next);
  return next;
}

export const useTabs = create<TabState>((set, get) => ({
  ...restore(),

  openTab: (kind, title) => {
    const id = nextId();
    set((s) => {
      // The first pane is named after the tab, so a tab that is never split
      // keeps the scrollback key it has always had.
      const tabs = [...s.tabs, { id, kind, title, layout: leaf(id), focusedPane: id, remotes: {} }];
      persist(tabs);
      return { tabs, activeId: id };
    });
    return id;
  },

  openRemoteTab: (hostId, title) => {
    const id = nextId();
    set((s) => {
      const tabs = [
        ...s.tabs,
        {
          id,
          kind: "terminal" as const,
          title,
          layout: leaf(id),
          focusedPane: id,
          remotes: { [id]: hostId },
        },
      ];
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
    // Closing a tab is the user removing it, so its saved output goes too —
    // every pane in it, not only the first. A split tab used to leave the
    // output of every pane but one behind on disk with nothing left to
    // claim it.
    const platform = getPlatform();
    for (const key of leaves(tabs[index].layout)) {
      void platform.scrollback.forget(key).catch(() => {});
    }
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

  splitPane: (tabId, paneId, dir) => {
    const created = nextPaneId();
    const tabs = withTab(get().tabs, tabId, (tab) =>
      hasLeaf(tab.layout, paneId)
        ? {
            ...tab,
            layout: splitLeaf(tab.layout, paneId, created, dir, nextSplitId()),
            // The new terminal takes the keyboard. Splitting and then having
            // to click the half you just asked for would defeat the point.
            focusedPane: created,
          }
        : tab,
    );
    if (tabs) set({ tabs });
  },

  closePane: (tabId, paneId) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab || !hasLeaf(tab.layout, paneId)) return;

    const layout = closeLeaf(tab.layout, paneId);
    // The last pane in a tab is the tab. Closing it leaves an empty box with
    // a title, which is not a thing anyone asked to keep.
    if (layout === null) {
      get().closeTab(tabId);
      return;
    }

    void getPlatform().scrollback.forget(paneId).catch(() => {});
    const focused = focusAfterClose(tab.layout, paneId) ?? leaves(layout)[0];
    const tabs = withTab(get().tabs, tabId, (t) => {
      const { [paneId]: _gone, ...remotes } = t.remotes;
      return { ...t, layout, focusedPane: focused, remotes };
    });
    if (tabs) set({ tabs });
  },

  focusPane: (tabId, paneId) => {
    const tabs = withTab(get().tabs, tabId, (tab) =>
      hasLeaf(tab.layout, paneId) ? { ...tab, focusedPane: paneId } : tab,
    );
    if (tabs) set({ tabs });
  },

  movePaneFocus: (tabId, side) => {
    const tab = get().tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const target = neighbour(tab.layout, tab.focusedPane, side);
    // Nothing that way. Doing nothing is right: wrapping around to the far
    // side would move the keyboard somewhere nobody was looking.
    if (!target) return;
    get().focusPane(tabId, target);
  },

  resizeSplit: (tabId, splitId, ratio) => {
    const tabs = withTab(get().tabs, tabId, (tab) => ({
      ...tab,
      layout: setRatio(tab.layout, splitId, ratio),
    }));
    if (tabs) set({ tabs });
  },
}));
