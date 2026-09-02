import { beforeEach, describe, expect, it } from "vitest";
import { APPS } from "../features/apps/registry";
import { APP_GROUPS, APPS_KEY } from "../features/apps/board";
import {
  addGroup,
  defaultLayout,
  duplicateItem,
  loadLayout,
  moveItem,
  reconcile,
  removeGroup,
  removeItem,
  renameGroup,
  restoreAll,
  saveLayout,
  setHidden,
  setSize,
  shownItems,
  togglePin,
  type Layout,
} from "./tileLayout";

const ids = (layout: Layout, group = 0) => layout.groups[group].items.map((i) => i.appId);
const find = (layout: Layout, appId: string) =>
  layout.groups.flatMap((g) => g.items).find((i) => i.appId === appId)!;

describe("defaultLayout", () => {
  /*
   * The layout everyone starts with is the one the grid already showed:
   * split by whether an app signs in to something. A first run should look
   * like a considered arrangement, not an empty editor.
   */
  it("starts as the grid people already know", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    expect(layout.groups.map((g) => g.name)).toEqual(APP_GROUPS.map((g) => g.name));

    const accounts = layout.groups.find((g) => g.name === "Your accounts")!;
    expect(accounts.items.map((i) => i.appId).sort()).toEqual(["github", "gmail"]);
  });

  it("places every app exactly once", () => {
    const placed = defaultLayout(APPS, APP_GROUPS).groups.flatMap((g) => g.items);
    expect(placed.map((i) => i.appId).sort()).toEqual(APPS.map((a) => a.id).sort());
  });

  // One app can appear more than once, so a placement needs its own identity.
  it("gives every placement a key of its own", () => {
    const keys = defaultLayout(APPS, APP_GROUPS).groups.flatMap((g) => g.items).map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("starts everything the same size, shown, and unpinned", () => {
    for (const item of defaultLayout(APPS, APP_GROUPS).groups.flatMap((g) => g.items)) {
      expect(item).toMatchObject({ size: "medium", pinned: false, hidden: false });
    }
  });
});

describe("moving", () => {
  it("reorders within a group", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const first = layout.groups[0].items[0];
    const moved = moveItem(layout, first.key, layout.groups[0].id, 2);
    expect(ids(moved).indexOf(first.appId)).toBe(2);
    expect(ids(moved)).toHaveLength(ids(layout).length);
  });

  it("moves between groups", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const item = layout.groups[0].items[0];
    const moved = moveItem(layout, item.key, layout.groups[1].id, 0);
    expect(moved.groups[1].items[0].appId).toBe(item.appId);
    expect(ids(moved, 0)).not.toContain(item.appId);
  });

  // Dropping past the end is what a drag to empty space below the last tile
  // means, and it should mean "last" rather than nothing.
  it("takes an index past the end as the end", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const item = layout.groups[0].items[0];
    const moved = moveItem(layout, item.key, layout.groups[0].id, 99);
    expect(ids(moved).at(-1)).toBe(item.appId);
  });

  it("ignores a move of something that is not there", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    expect(moveItem(layout, "nope", layout.groups[0].id, 0)).toEqual(layout);
    expect(moveItem(layout, layout.groups[0].items[0].key, "nope", 0)).toEqual(layout);
  });

  // Pinned tiles are held at the top of their group, so an order that put one
  // below an unpinned tile would be an order the grid could not honour.
  it("keeps pinned tiles at the top however they are ordered", () => {
    let layout = defaultLayout(APPS, APP_GROUPS);
    const last = layout.groups[0].items.at(-1)!;
    layout = togglePin(layout, last.key);
    expect(shownItems(layout.groups[0])[0].appId).toBe(last.appId);
  });
});

describe("sizing", () => {
  it("changes one tile's size and no other", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const target = layout.groups[0].items[1];
    const sized = setSize(layout, target.key, "large");

    expect(find(sized, target.appId).size).toBe("large");
    expect(sized.groups[0].items[0].size).toBe("medium");
  });

  it("refuses a size that is not one", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const key = layout.groups[0].items[0].key;
    // @ts-expect-error deliberately wrong, because a stored layout is data
    // from disk and disk contents are not typed.
    expect(setSize(layout, key, "enormous")).toEqual(layout);
  });
});

describe("hiding, and getting things back", () => {
  it("hides a tile without losing it", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const target = layout.groups[0].items[0];
    const hidden = setHidden(layout, target.key, true);

    expect(shownItems(hidden.groups[0]).map((i) => i.appId)).not.toContain(target.appId);
    expect(find(hidden, target.appId).hidden).toBe(true);
  });

  /*
   * Delete is the only operation that loses something, so it has to be
   * undoable. A launcher you can permanently break by mis-clicking is worse
   * than one you cannot rearrange at all.
   */
  it("brings back everything that was hidden or deleted", () => {
    let layout = defaultLayout(APPS, APP_GROUPS);
    layout = setHidden(layout, layout.groups[0].items[0].key, true);
    layout = removeItem(layout, layout.groups[0].items[1].key);

    const back = reconcile(restoreAll(layout), APPS, APP_GROUPS);
    const placed = back.groups.flatMap((g) => g.items).filter((i) => !i.hidden);
    expect(placed.map((i) => i.appId).sort()).toEqual(APPS.map((a) => a.id).sort());
  });

  it("removes a tile entirely", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const target = layout.groups[0].items[0];
    const gone = removeItem(layout, target.key);
    expect(gone.groups.flatMap((g) => g.items).map((i) => i.key)).not.toContain(target.key);
  });
});

describe("duplicating", () => {
  it("puts the same app in another group", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const target = layout.groups[0].items[0];
    const copied = duplicateItem(layout, target.key, layout.groups[1].id);

    expect(copied.groups[1].items.map((i) => i.appId)).toContain(target.appId);
    expect(copied.groups[0].items.map((i) => i.appId)).toContain(target.appId);
  });

  // Two placements of one app are two tiles, and the editor addresses tiles
  // by key. Sharing a key would move both when one was dragged.
  it("gives the copy a key of its own", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const target = layout.groups[0].items[0];
    const copied = duplicateItem(layout, target.key, layout.groups[1].id);
    const keys = copied.groups.flatMap((g) => g.items).map((i) => i.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("ignores a duplicate of something that is not there", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    expect(duplicateItem(layout, "nope", layout.groups[0].id)).toEqual(layout);
  });
});

describe("groups", () => {
  it("adds a group", () => {
    const layout = addGroup(defaultLayout(APPS, APP_GROUPS), "Daily");
    expect(layout.groups.at(-1)!.name).toBe("Daily");
    expect(layout.groups.at(-1)!.items).toEqual([]);
  });

  it("renames one", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const renamed = renameGroup(layout, layout.groups[0].id, "  Everyday  ");
    expect(renamed.groups[0].name).toBe("Everyday");
  });

  it("refuses to rename a group to nothing", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    expect(renameGroup(layout, layout.groups[0].id, "   ")).toEqual(layout);
  });

  /*
   * Removing a group must not remove the apps in it. Someone tidying their
   * sections is not asking to lose six tiles, and a launcher that took that
   * as permission would be one nobody edits twice.
   */
  it("keeps the apps when a group goes", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    const doomed = layout.groups[1];
    const after = removeGroup(layout, doomed.id);

    expect(after.groups.map((g) => g.id)).not.toContain(doomed.id);
    for (const item of doomed.items) {
      expect(after.groups.flatMap((g) => g.items).map((i) => i.appId)).toContain(item.appId);
    }
  });

  // Somewhere has to hold the tiles, and a layout with no groups has nowhere
  // to drop anything.
  it("never removes the last group", () => {
    let layout = defaultLayout(APPS, APP_GROUPS);
    while (layout.groups.length > 1) layout = removeGroup(layout, layout.groups[0].id);
    expect(removeGroup(layout, layout.groups[0].id)).toEqual(layout);
  });
});

describe("reconcile", () => {
  /*
   * A stored layout is from an older version of the app. Apps get added and
   * removed; neither should leave a saved arrangement broken.
   */
  it("places an app the stored layout never heard of", () => {
    const layout = defaultLayout(APPS.filter((a) => a.id !== "gmail"), APP_GROUPS);
    const after = reconcile(layout, APPS, APP_GROUPS);
    expect(after.groups.flatMap((g) => g.items).map((i) => i.appId)).toContain("gmail");
  });

  it("drops a placement for an app that no longer exists", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    layout.groups[0].items.push({
      key: "ghost",
      appId: "app-that-was-removed",
      size: "medium",
      pinned: false,
      hidden: false,
    });
    const after = reconcile(layout, APPS, APP_GROUPS);
    expect(after.groups.flatMap((g) => g.items).map((i) => i.appId)).not.toContain(
      "app-that-was-removed",
    );
  });

  // A new app should not reappear after being deliberately hidden.
  it("does not re-add an app that is present but hidden", () => {
    let layout = defaultLayout(APPS, APP_GROUPS);
    layout = setHidden(layout, find(layout, "calculator").key, true);
    const after = reconcile(layout, APPS, APP_GROUPS);
    expect(after.groups.flatMap((g) => g.items).filter((i) => i.appId === "calculator")).toHaveLength(1);
  });

  it("leaves a layout that is already right alone", () => {
    const layout = defaultLayout(APPS, APP_GROUPS);
    expect(reconcile(layout, APPS, APP_GROUPS)).toEqual(layout);
  });
});

describe("persistence", () => {
  beforeEach(() => localStorage.clear());

  it("survives a round trip", () => {
    const built = defaultLayout(APPS, APP_GROUPS);
    const layout = setSize(built, built.groups[0].items[0].key, "large");
    saveLayout(APPS_KEY, layout);

    const back = loadLayout(APPS_KEY, APPS, APP_GROUPS);
    expect(back.groups.length).toBe(layout.groups.length);
    // The point of storing it: the size survives.
    expect(back.groups[0].items[0].size).toBe("large");
  });

  // Compared by shape, not by identity: every placement gets a key of its
  // own, so two freshly built defaults are equal in every way that matters
  // and identical in none.
  it("falls back to the default when nothing is stored", () => {
    const shape = (l: Layout) =>
      l.groups.map((g) => ({ name: g.name, apps: g.items.map((i) => i.appId) }));
    expect(shape(loadLayout(APPS_KEY, APPS, APP_GROUPS))).toEqual(shape(defaultLayout(APPS, APP_GROUPS)));
  });

  /*
   * Stored layouts are data from disk, and disk contents are not typed. A
   * corrupt one must give back a working grid rather than an empty screen —
   * the failure mode otherwise is an app that opens to nothing and cannot be
   * fixed from inside itself.
   */
  it("falls back rather than breaking on nonsense", () => {
    for (const junk of ["", "not json", "[]", '{"groups":"no"}', '{"version":99}']) {
      localStorage.setItem(APPS_KEY, junk);
      expect(loadLayout(APPS_KEY, APPS, APP_GROUPS).groups.length).toBeGreaterThan(0);
      expect(loadLayout(APPS_KEY, APPS, APP_GROUPS).groups.flatMap((g) => g.items).length).toBe(APPS.length);
    }
  });

  it("reconciles what it loads, so a stored layout is never stale", () => {
    saveLayout(APPS_KEY, defaultLayout(APPS.filter((a) => a.id !== "gmail"), APP_GROUPS));
    expect(loadLayout(APPS_KEY, APPS, APP_GROUPS).groups.flatMap((g) => g.items).map((i) => i.appId)).toContain("gmail");
  });
});
