import type { AppDef } from "./registry";

/**
 * How the Apps grid is arranged, and every way it can be rearranged.
 *
 * Kept as plain data with pure operations over it, separate from anything
 * that draws. The editor is the part most likely to grow — a drag lands in
 * the wrong place, a group is removed with tiles in it, an app is added in a
 * later version — and every one of those is a question about this model
 * rather than about React.
 *
 * Two rules the operations exist to keep. **Nothing is lost by accident**:
 * removing a group keeps its tiles, hiding is reversible, and even delete is
 * undone by `restoreAll`, because a launcher you can permanently break by
 * mis-clicking is worse than one you cannot rearrange at all. And **a stored
 * layout is data from disk**, so it is reconciled against the registry on
 * every load rather than trusted — apps get added and removed, and neither
 * should leave someone's arrangement broken.
 */

export type TileSize = "small" | "medium" | "large";

const SIZES: TileSize[] = ["small", "medium", "large"];

/** One app in one place. An app may have several. */
export interface Placement {
  /** This tile's identity. One app can appear more than once, so the app id
   *  cannot be it — two placements sharing a key would drag as one. */
  key: string;
  appId: string;
  size: TileSize;
  /** Held at the top of its group, whatever the order says. */
  pinned: boolean;
  /** Out of the grid, but not gone. */
  hidden: boolean;
}

export interface Group {
  id: string;
  name: string;
  items: Placement[];
}

export interface Layout {
  version: 1;
  groups: Group[];
}

export const STORAGE_KEY = "jky.apps.layout";

/**
 * The groups a first run starts with.
 *
 * The split the grid already used, because a first run should look like a
 * considered arrangement rather than an empty editor.
 */
export const DEFAULT_GROUPS: { name: string; holds: (app: AppDef) => boolean }[] = [
  { name: "Ready to use", holds: (app) => app.section === "app" && app.auth === "none" },
  { name: "Your accounts", holds: (app) => app.section === "app" && app.auth !== "none" },
  { name: "Developer tools", holds: (app) => app.section === "tool" },
];

let counter = 0;

/** A key no other placement has. */
function newKey(): string {
  counter += 1;
  return `t${Date.now().toString(36)}-${counter.toString(36)}`;
}

function place(appId: string): Placement {
  return { key: newKey(), appId, size: "medium", pinned: false, hidden: false };
}

export function defaultLayout(apps: AppDef[]): Layout {
  return {
    version: 1,
    groups: DEFAULT_GROUPS.map((group, i) => ({
      id: `g${i}`,
      name: group.name,
      items: apps.filter(group.holds).map((app) => place(app.id)),
    })),
  };
}

/** Structural sharing is not worth the bugs here; every operation copies. */
function copy(layout: Layout): Layout {
  return {
    version: 1,
    groups: layout.groups.map((g) => ({ ...g, items: g.items.map((i) => ({ ...i })) })),
  };
}

function locate(layout: Layout, key: string): { group: Group; index: number } | null {
  for (const group of layout.groups) {
    const index = group.items.findIndex((i) => i.key === key);
    if (index !== -1) return { group, index };
  }
  return null;
}

/**
 * What a group shows, in the order it shows it.
 *
 * Pinned first and hidden not at all. Pinning is applied here rather than by
 * reordering on pin, so unpinning puts a tile back where it was instead of
 * wherever the pin happened to move it.
 */
export function shownItems(group: Group): Placement[] {
  const shown = group.items.filter((i) => !i.hidden);
  return [...shown.filter((i) => i.pinned), ...shown.filter((i) => !i.pinned)];
}

export function moveItem(
  layout: Layout,
  key: string,
  toGroupId: string,
  toIndex: number,
): Layout {
  const next = copy(layout);
  const found = locate(next, key);
  const target = next.groups.find((g) => g.id === toGroupId);
  if (!found || !target) return layout;

  const [item] = found.group.items.splice(found.index, 1);
  // Past the end means the end: dragging to the empty space below the last
  // tile is how anyone asks for "last".
  target.items.splice(Math.min(Math.max(toIndex, 0), target.items.length), 0, item);
  return next;
}

export function setSize(layout: Layout, key: string, size: TileSize): Layout {
  if (!SIZES.includes(size)) return layout;
  const next = copy(layout);
  const found = locate(next, key);
  if (!found) return layout;
  found.group.items[found.index].size = size;
  return next;
}

export function togglePin(layout: Layout, key: string): Layout {
  const next = copy(layout);
  const found = locate(next, key);
  if (!found) return layout;
  const item = found.group.items[found.index];
  item.pinned = !item.pinned;
  return next;
}

export function setHidden(layout: Layout, key: string, hidden: boolean): Layout {
  const next = copy(layout);
  const found = locate(next, key);
  if (!found) return layout;
  found.group.items[found.index].hidden = hidden;
  return next;
}

export function removeItem(layout: Layout, key: string): Layout {
  const next = copy(layout);
  const found = locate(next, key);
  if (!found) return layout;
  found.group.items.splice(found.index, 1);
  return next;
}

export function duplicateItem(layout: Layout, key: string, toGroupId: string): Layout {
  const next = copy(layout);
  const found = locate(next, key);
  const target = next.groups.find((g) => g.id === toGroupId);
  if (!found || !target) return layout;

  const source = found.group.items[found.index];
  target.items.push({ ...source, key: newKey(), pinned: false, hidden: false });
  return next;
}

export function addGroup(layout: Layout, name: string): Layout {
  const trimmed = name.trim();
  if (!trimmed) return layout;
  const next = copy(layout);
  next.groups.push({ id: `g${Date.now().toString(36)}-${next.groups.length}`, name: trimmed, items: [] });
  return next;
}

export function renameGroup(layout: Layout, groupId: string, name: string): Layout {
  const trimmed = name.trim();
  if (!trimmed) return layout;
  const next = copy(layout);
  const group = next.groups.find((g) => g.id === groupId);
  if (!group) return layout;
  group.name = trimmed;
  return next;
}

/**
 * Remove a group, keeping what was in it.
 *
 * Its tiles move to the group before it. Someone tidying their sections is
 * not asking to lose six apps, and a launcher that read it that way is one
 * nobody edits twice. The last group never goes: something has to hold the
 * tiles, and a layout with none has nowhere to drop anything.
 */
export function removeGroup(layout: Layout, groupId: string): Layout {
  if (layout.groups.length <= 1) return layout;
  const next = copy(layout);
  const index = next.groups.findIndex((g) => g.id === groupId);
  if (index === -1) return layout;

  const [gone] = next.groups.splice(index, 1);
  const keeper = next.groups[Math.max(0, index - 1)];
  keeper.items.push(...gone.items);
  return next;
}

/** Everything hidden becomes visible again. The way back from a mistake. */
export function restoreAll(layout: Layout): Layout {
  const next = copy(layout);
  for (const group of next.groups) {
    for (const item of group.items) item.hidden = false;
  }
  return next;
}

/**
 * Bring a stored layout up to date with the registry.
 *
 * Apps added since it was saved are placed where a first run would put them;
 * placements for apps that no longer exist are dropped. An app that is
 * present but hidden is left alone — it was hidden on purpose, and re-adding
 * it would make hiding useless the moment anything else changed.
 */
export function reconcile(layout: Layout, apps: AppDef[]): Layout {
  const known = new Set(apps.map((a) => a.id));
  const next = copy(layout);

  for (const group of next.groups) {
    group.items = group.items.filter((i) => known.has(i.appId));
  }

  const placed = new Set(next.groups.flatMap((g) => g.items).map((i) => i.appId));
  for (const app of apps) {
    if (placed.has(app.id)) continue;
    const wanted = DEFAULT_GROUPS.findIndex((g) => g.holds(app));
    const group = next.groups[wanted] ?? next.groups[0];
    group.items.push(place(app.id));
  }

  return next;
}

/** Whether a value read from storage is the shape this expects. */
function isLayout(value: unknown): value is Layout {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !Array.isArray(v.groups) || v.groups.length === 0) return false;

  return v.groups.every((g: unknown) => {
    if (typeof g !== "object" || g === null) return false;
    const group = g as Record<string, unknown>;
    return (
      typeof group.id === "string" &&
      typeof group.name === "string" &&
      Array.isArray(group.items) &&
      group.items.every((i: unknown) => {
        if (typeof i !== "object" || i === null) return false;
        const item = i as Record<string, unknown>;
        return (
          typeof item.key === "string" &&
          typeof item.appId === "string" &&
          SIZES.includes(item.size as TileSize) &&
          typeof item.pinned === "boolean" &&
          typeof item.hidden === "boolean"
        );
      })
    );
  });
}

export function saveLayout(layout: Layout): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  } catch {
    // A private window has no storage. The arrangement lasts the session.
  }
}

/**
 * The stored layout, reconciled — or the default if there is none, or if what
 * is stored is not a layout.
 *
 * Falling back rather than throwing matters more here than it looks: the
 * failure mode otherwise is an Apps section that opens to nothing, and no way
 * to fix it from inside the app.
 */
export function loadLayout(apps: AppDef[]): Layout {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isLayout(parsed)) return reconcile(parsed, apps);
    }
  } catch {
    // Unreadable storage, or JSON that is not. Either way, start clean.
  }
  return defaultLayout(apps);
}
