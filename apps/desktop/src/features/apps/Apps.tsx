import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppSwitcher } from "./AppSwitcher";
import { APPS, findApp, type AppDef } from "./registry";
import {
  addGroup,
  defaultLayout,
  duplicateItem,
  loadLayout,
  moveItem,
  removeGroup,
  removeItem,
  renameGroup,
  restoreAll,
  saveLayout,
  setHidden,
  setSize,
  shownItems,
  togglePin,
  type Group,
  type Layout,
  type Placement,
  type TileSize,
} from "./layout";
import { Calculator } from "./calculator/Calculator";
import { Browser } from "./browser/Browser";
import { GitHub } from "./github/GitHub";
import { Gmail } from "./gmail/Gmail";
import { MapApp } from "./map/Map";
import { News } from "./news/News";
import { Timer } from "./timer/Timer";
import { Weather } from "./weather/Weather";
import { useNav } from "../../app/navStore";
import "./Apps.css";

/** Which apps are open, and which one is on screen. */
interface Session {
  open: string[];
  /** Null means the grid is showing; the open apps stay open behind it. */
  active: string | null;
}

const SESSION_KEY = "jky.apps.session";

function loadSession(): Session {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed === "object" && parsed !== null) {
        // Filtered against the registry, so an app removed in a later version
        // does not leave a tab that opens nothing.
        const open = ((parsed as Session).open ?? []).filter((id) => findApp(id));
        const active = (parsed as Session).active;
        return { open, active: active && open.includes(active) ? active : null };
      }
    }
  } catch {
    // Storage throws in a private window; an empty session is a fine default.
  }
  return { open: [], active: null };
}

/**
 * The body of one app.
 *
 * A switch rather than a component stored on the registry record, because the
 * registry is plain data read by tests and by the Rust side — putting React
 * components in it would make it un-shareable for the sake of saving this.
 */
function appBody(id: string): ReactNode {
  switch (id) {
    case "calculator":
      return <Calculator />;
    case "timer":
      return <Timer />;
    case "weather":
      return <Weather />;
    case "news":
      return <News />;
    case "map":
      return <MapApp />;
    case "github":
      return <GitHub />;
    case "gmail":
      return <Gmail />;
    case "browser":
      return <Browser />;
    default:
      return null;
  }
}

/**
 * The Apps section.
 *
 * Several apps can be open at once, the way terminal tabs are. Every open app
 * stays mounted and the inactive ones are hidden rather than unmounted, which
 * is the whole point of having two open: a timer keeps counting while you look
 * at the weather, and a half-typed sum is still there when you come back.
 *
 * That is a deliberate reversal. This section used to unmount the app you left
 * so nothing ran unseen — right when only one could be open, wrong once
 * keeping one running in the background is the feature being asked for. The
 * section as a whole is still unmounted when you leave it for the terminal, so
 * nothing runs while Apps is not the place you are.
 */
export function Apps() {
  const [session, setSession] = useState<Session>(loadSession);
  const [switching, setSwitching] = useState(false);

  const { open, active } = session;
  const current = active ? findApp(active) : undefined;

  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch {
      // Preference lost; the apps still work.
    }
  }, [session]);

  /** Open an app, or bring it forward when it already is. */
  const openApp = useCallback((id: string) => {
    setSession((s) => ({
      open: s.open.includes(id) ? s.open : [...s.open, id],
      active: id,
    }));
    setSwitching(false);
  }, []);

  const showGrid = useCallback(() => {
    setSession((s) => ({ ...s, active: null }));
  }, []);

  // The palette can ask for a named app; the request is left in the store for
  // this section to take, so which app was wanted survives the section switch.
  const pendingNav = useNav((s) => s.pending);
  useEffect(() => {
    const wanted = useNav.getState().takePanel("apps");
    if (!wanted) return;
    if (wanted === "grid") showGrid();
    else if (findApp(wanted)) openApp(wanted);
  }, [pendingNav, openApp, showGrid]);

  // Bound here rather than in `useShortcuts` because it means nothing outside
  // this section, and a global binding for it would be one more chord to think
  // about while typing into a terminal.
  useEffect(() => {
    if (!current) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSwitching((s) => !s);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current]);

  function closeApp(id: string) {
    setSession((s) => {
      const open = s.open.filter((x) => x !== id);
      if (s.active !== id) return { open, active: s.active };
      // Closing what you are looking at moves to a neighbour rather than
      // dropping you back to the grid with other apps still open.
      const wasAt = s.open.indexOf(id);
      const next = open[Math.min(wasAt, open.length - 1)] ?? null;
      return { open, active: next };
    });
  }

  return (
    <div className="apps-shell">
      {open.length > 0 && (
        <div className="apps__tabstrip">
          <div className="apps__tabs" role="tablist" aria-label="Open apps">
            {open.map((id) => {
              const app = findApp(id);
              if (!app) return null;
              return (
                // A tablist may contain only role=tab elements — not a wrapper
                // with a second button in it. So the close affordance lives
                // inside the tab, the same deletable-tabs pattern the terminal
                // tabs already follow: a decorative glyph for the mouse, and
                // Delete/Backspace for the keyboard, which aria-keyshortcuts
                // advertises to assistive technology.
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={active === id}
                  aria-keyshortcuts="Delete"
                  className="apps__tab"
                  style={{ ["--app-accent" as string]: `var(--${app.accent})` }}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).dataset.close === "true") closeApp(id);
                    else setSession((s) => ({ ...s, active: id }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Delete" || e.key === "Backspace") {
                      e.preventDefault();
                      closeApp(id);
                    }
                  }}
                >
                  <span className="apps__tab-glyph" aria-hidden="true">
                    {app.glyph}
                  </span>
                  <span className="apps__tab-name">{app.name}</span>
                  <span className="apps__tab-close" data-close="true" aria-hidden="true">
                    ×
                  </span>
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="apps__tab-add"
            // Not "All apps": the header already has one of those, and two
            // controls with the same name is ambiguous to a screen reader as
            // well as to a test.
            aria-label="Open another app"
            onClick={showGrid}
          >
            +
          </button>
        </div>
      )}

      {!current && <AppGrid onOpen={openApp} openIds={open} />}

      {/* Every open app stays mounted; only the active one is shown. Hiding
          rather than unmounting is what lets a timer keep counting and a
          half-typed sum survive a trip to the weather. */}
      {open.map((id) => {
        const app = findApp(id);
        if (!app) return null;
        return (
          <div
            key={id}
            className="apps apps--open"
            hidden={active !== id}
            style={{ ["--app-accent" as string]: `var(--${app.accent})` }}
          >
            <header className="apps__bar">
              <button type="button" className="apps__back" onClick={showGrid}>
                <span aria-hidden="true">←</span> All apps
              </button>
              <h1 className="apps__open-title">
                <span className="apps__open-glyph" aria-hidden="true">
                  {app.glyph}
                </span>
                {app.name}
              </h1>
              <button
                type="button"
                className="apps__switch"
                aria-haspopup="dialog"
                onClick={() => setSwitching(true)}
              >
                Switch app
                <kbd className="apps__chord">Ctrl+Shift+A</kbd>
              </button>
            </header>

            <div className="apps__stage">{appBody(app.id)}</div>
          </div>
        );
      })}

      {switching && current && (
        <AppSwitcher
          currentId={current.id}
          openIds={open}
          onChoose={openApp}
          onClose={() => setSwitching(false)}
        />
      )}
    </div>
  );
}

/**
 * The grid, arranged by the layout.
 *
 * The arrangement is the user's, stored and reconciled against the registry
 * on every load — see `layout.ts`. What ships is the split the grid always
 * had, so a first run looks like a considered arrangement rather than an
 * empty editor.
 *
 * Editing is a mode. Outside it a tile is a button that opens an app; a grid
 * where every tile also carries six controls is a grid you cannot use for the
 * thing it is for.
 */
function AppGrid({ onOpen, openIds }: { onOpen: (id: string) => void; openIds: string[] }) {
  const [layout, setLayout] = useState<Layout>(() => loadLayout(APPS));
  const [editing, setEditing] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const hidden = layout.groups.flatMap((g) => g.items).filter((i) => i.hidden).length;
  const shown = layout.groups.flatMap((g) => shownItems(g)).length;

  /** Every drop target needs the same handler; only the index differs. */
  function drop(groupId: string, index: number) {
    return (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (dragging) setLayout((l) => moveItem(l, dragging, groupId, index));
      setDragging(null);
    };
  }

  return (
    <div className="apps">
      <header className="apps__head" aria-label="Apps">
        <p className="apps__eyebrow">
          <span>{shown} apps</span>
          <span className="apps__eyebrow-sep" aria-hidden="true">
            ·
          </span>
          <span>{layout.groups.length} groups</span>
          {hidden > 0 && (
            <>
              <span className="apps__eyebrow-sep" aria-hidden="true">
                ·
              </span>
              <span>{hidden} hidden</span>
            </>
          )}
        </p>
        <h1 className="apps__title">Apps</h1>
        <p className="apps__lede">
          Open as many as you like — they stay open in tabs above. Press{" "}
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to move between them.
        </p>

        <div className="apps__tools">
          <button
            type="button"
            className="apps__tool"
            aria-pressed={editing}
            onClick={() => setEditing((on) => !on)}
          >
            {editing ? "Done" : "Edit layout"}
          </button>
          {editing && (
            <>
              <button
                type="button"
                className="apps__tool"
                onClick={() => {
                  // Straight into the name field: you name a thing when you
                  // make it, and "New group" is not a name anyone wanted.
                  const next = addGroup(layout, "New group");
                  setLayout(next);
                  setNaming(next.groups.at(-1)!.id);
                }}
              >
                Add group
              </button>
              {/* Only offered when there is something to bring back, so it is
                  never a button that does nothing. */}
              {hidden > 0 && (
                <button
                  type="button"
                  className="apps__tool"
                  onClick={() => setLayout(restoreAll)}
                >
                  Restore {hidden} hidden
                </button>
              )}
              <button
                type="button"
                className="apps__tool apps__tool--quiet"
                onClick={() => setLayout(defaultLayout(APPS))}
              >
                Reset
              </button>
            </>
          )}
        </div>
      </header>

      <div className="apps__groups" role="region" aria-label="Apps">
        {layout.groups.map((group) => (
          <section className="apps__group" key={group.id} data-editing={editing || undefined}>
            <div className="apps__group-head">
              {naming === group.id ? (
                <input
                  className="apps__group-input"
                  aria-label="Group name"
                  defaultValue={group.name}
                  autoFocus
                  onBlur={(e) => {
                    setLayout((l) => renameGroup(l, group.id, e.target.value));
                    setNaming(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setNaming(null);
                  }}
                />
              ) : (
                <h2 className="apps__group-name">{group.name}</h2>
              )}
              <span className="apps__group-count" aria-hidden="true">
                {shownItems(group).length}
              </span>
              {editing && (
                <span className="apps__group-tools">
                  <button
                    type="button"
                    className="apps__tool apps__tool--small"
                    onClick={() => setNaming(group.id)}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="apps__tool apps__tool--small"
                    aria-label={`Remove group ${group.name}`}
                    disabled={layout.groups.length <= 1}
                    onClick={() => setLayout((l) => removeGroup(l, group.id))}
                  >
                    Remove group
                  </button>
                </span>
              )}
            </div>

            <ul
              className="apps__grid"
              aria-label={group.name}
              onDragOver={editing ? (e) => e.preventDefault() : undefined}
              onDrop={editing ? drop(group.id, Number.MAX_SAFE_INTEGER) : undefined}
            >
              {shownItems(group).map((item, index) => {
                const app = findApp(item.appId);
                if (!app) return null;
                return (
                  <li
                    key={item.key}
                    onDragOver={editing ? (e) => e.preventDefault() : undefined}
                    onDrop={editing ? drop(group.id, index) : undefined}
                  >
                    <Tile
                      app={app}
                      item={item}
                      open={openIds.includes(app.id)}
                      editing={editing}
                      dragging={dragging === item.key}
                      groups={layout.groups}
                      onOpen={onOpen}
                      onDragStart={() => setDragging(item.key)}
                      onDragEnd={() => setDragging(null)}
                      onChange={setLayout}
                    />
                  </li>
                );
              })}

              {editing && shownItems(group).length === 0 && (
                <li className="apps__empty">Drag an app here.</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function Tile({
  app,
  item,
  open,
  editing,
  dragging,
  groups,
  onOpen,
  onDragStart,
  onDragEnd,
  onChange,
}: {
  app: AppDef;
  item: Placement;
  open: boolean;
  editing: boolean;
  dragging: boolean;
  groups: Group[];
  onOpen: (id: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onChange: (update: (l: Layout) => Layout) => void;
}) {
  /** Small → medium → large → small. One button rather than three. */
  const nextSize: TileSize =
    item.size === "small" ? "medium" : item.size === "medium" ? "large" : "small";

  /** Where a duplicate goes: the next group round, so one click is enough. */
  const elsewhere =
    groups[(groups.findIndex((g) => g.items.some((i) => i.key === item.key)) + 1) % groups.length];

  return (
    // A group rather than a button while editing: it holds controls, and a
    // button containing buttons is invalid and unusable with a keyboard.
    <div
      className="apps__tile"
      role="group"
      aria-label={app.name}
      data-size={item.size}
      data-editing={editing || undefined}
      data-dragging={dragging || undefined}
      data-pinned={item.pinned || undefined}
      // Set as a variable rather than a class per app, so adding an app is a
      // registry entry and never a new stylesheet rule.
      style={{ ["--app-accent" as string]: `var(--${app.accent})` }}
      draggable={editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
    >
      {/* Outside edit mode the whole tile is one button. Inside it, the tile
          is a thing being arranged and clicking it must not launch anything. */}
      {editing ? (
        <span className="apps__tile-face">
          <TileFace app={app} open={open} pinned={item.pinned} />
        </span>
      ) : (
        <button type="button" className="apps__tile-face" onClick={() => onOpen(app.id)}>
          <TileFace app={app} open={open} pinned={item.pinned} />
          <span className="apps__tile-go" aria-hidden="true">
            →
          </span>
        </button>
      )}

      {editing && (
        <div className="apps__tile-edit">
          <button
            type="button"
            className="apps__pill"
            aria-label={`Size: ${item.size}`}
            onClick={() => onChange((l) => setSize(l, item.key, nextSize))}
          >
            {item.size[0].toUpperCase()}
          </button>
          <button
            type="button"
            className="apps__pill"
            aria-pressed={item.pinned}
            aria-label={item.pinned ? "Unpin" : "Pin"}
            onClick={() => onChange((l) => togglePin(l, item.key))}
          >
            ⚲
          </button>
          <button
            type="button"
            className="apps__pill"
            aria-label="Duplicate"
            onClick={() => onChange((l) => duplicateItem(l, item.key, elsewhere.id))}
          >
            ⧉
          </button>
          <button
            type="button"
            className="apps__pill"
            aria-label="Hide"
            onClick={() => onChange((l) => setHidden(l, item.key, true))}
          >
            ◯
          </button>
          <button
            type="button"
            className="apps__pill apps__pill--danger"
            aria-label="Remove"
            onClick={() => onChange((l) => removeItem(l, item.key))}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}

/** What a tile says, whichever mode it is in. */
function TileFace({ app, open, pinned }: { app: AppDef; open: boolean; pinned: boolean }) {
  return (
    <>
      <span className="apps__tile-well" aria-hidden="true">
        <span className="apps__tile-glyph">{app.glyph}</span>
      </span>
      <span className="apps__tile-name">{app.name}</span>
      <span className="apps__tile-blurb">{app.blurb}</span>
      <span className="apps__tile-feet">
        {pinned && <span className="apps__tile-open">pinned</span>}
        {open && <span className="apps__tile-open">open</span>}
        {app.auth !== "none" && <span className="apps__tile-auth">needs {app.auth}</span>}
      </span>
    </>
  );
}
