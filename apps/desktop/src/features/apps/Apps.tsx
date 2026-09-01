import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppSwitcher } from "./AppSwitcher";
import { APPS, findApp, type AppDef } from "./registry";
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
 * The grid, in two groups.
 *
 * Split by whether an app signs in to something, because that is the one
 * thing worth knowing before clicking a tile and it is already a field on the
 * registry record. Structure carrying a fact, rather than eight tiles in an
 * undifferentiated rack.
 *
 * Both counts are derived. The header used to read "no account needed", which
 * stopped being true the moment GitHub arrived and stayed on screen through
 * Gmail — a sentence that cannot go stale is worth more than a shorter one.
 */
function AppGrid({ onOpen, openIds }: { onOpen: (id: string) => void; openIds: string[] }) {
  const ready = APPS.filter((app) => app.auth === "none");
  const accounts = APPS.filter((app) => app.auth !== "none");

  return (
    <div className="apps">
      <header className="apps__head" aria-label="Apps">
        <p className="apps__eyebrow">
          <span>{APPS.length} apps</span>
          <span className="apps__eyebrow-sep" aria-hidden="true">
            ·
          </span>
          <span>{ready.length} need nothing but a click</span>
        </p>
        <h1 className="apps__title">Apps</h1>
        <p className="apps__lede">
          Open as many as you like — they stay open in tabs above. Press{" "}
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to move between them.
        </p>
      </header>

      <div className="apps__groups" role="region" aria-label="Apps">
        <Group
          name="Ready to use"
          note="No account, no key, nothing to set up."
          apps={ready}
          openIds={openIds}
          onOpen={onOpen}
        />
        <Group
          name="Your accounts"
          note="Signs in through your own browser. Read-only, both of them."
          apps={accounts}
          openIds={openIds}
          onOpen={onOpen}
        />
      </div>
    </div>
  );
}

/** One labelled group of tiles. A group with nothing in it is not drawn. */
function Group({
  name,
  note,
  apps,
  openIds,
  onOpen,
}: {
  name: string;
  note: string;
  apps: AppDef[];
  openIds: string[];
  onOpen: (id: string) => void;
}) {
  if (apps.length === 0) return null;

  return (
    <section className="apps__group">
      <div className="apps__group-head">
        <h2 className="apps__group-name">{name}</h2>
        <p className="apps__group-note">{note}</p>
        <span className="apps__group-count" aria-hidden="true">
          {apps.length}
        </span>
      </div>
      <ul className="apps__grid" aria-label={name}>
        {apps.map((app) => (
          <li key={app.id}>
            <Tile app={app} open={openIds.includes(app.id)} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({
  app,
  open,
  onOpen,
}: {
  app: AppDef;
  open: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="apps__tile"
      // Set as a variable rather than a class per app, so adding an app is a
      // registry entry and never a new stylesheet rule.
      style={{ ["--app-accent" as string]: `var(--${app.accent})` }}
      onClick={() => onOpen(app.id)}
    >
      <span className="apps__tile-well" aria-hidden="true">
        <span className="apps__tile-glyph">{app.glyph}</span>
      </span>
      <span className="apps__tile-name">{app.name}</span>
      <span className="apps__tile-blurb">{app.blurb}</span>
      <span className="apps__tile-feet">
        {open && <span className="apps__tile-open">open</span>}
        {app.auth !== "none" && <span className="apps__tile-auth">needs {app.auth}</span>}
      </span>
      {/* Points the way on hover and focus. Decorative: the whole tile is the
          button, and its name already says where it goes. */}
      <span className="apps__tile-go" aria-hidden="true">
        →
      </span>
    </button>
  );
}
