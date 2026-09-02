import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppSwitcher } from "./AppSwitcher";
import { APPS, findApp } from "./registry";
import { TileBoard } from "../../components/TileBoard";
import { TabStrip } from "../../components/TabStrip";
import {
  closeIn,
  loadSession,
  openIn,
  saveSession,
  showBoard,
  type Session,
} from "../../lib/boardSession";
import { APP_GROUPS, APPS_KEY } from "./board";

const SESSION_KEY = "jky.apps.session";
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
  const [session, setSession] = useState<Session>(() =>
    loadSession(SESSION_KEY, (id) => findApp(id) !== undefined),
  );
  const [switching, setSwitching] = useState(false);

  const { open, active } = session;
  const current = active ? findApp(active) : undefined;

  useEffect(() => {
    try {
      saveSession(SESSION_KEY, session);
    } catch {
      // Preference lost; the apps still work.
    }
  }, [session]);

  /** Open an app, or bring it forward when it already is. */
  const openApp = useCallback((id: string) => {
    setSession((s) => openIn(s, id));
    setSwitching(false);
  }, []);

  const showGrid = useCallback(() => {
    setSession(showBoard);
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
    setSession((s) => closeIn(s, id));
  }

  return (
    <div className="apps-shell">
      <TabStrip
        label="Open apps"
        tabs={open.flatMap((id) => {
          const app = findApp(id);
          return app ? [{ id, name: app.name, glyph: app.glyph, accent: app.accent }] : [];
        })}
        activeId={active}
        onSelect={(id) => setSession((s) => ({ ...s, active: id }))}
        onClose={closeApp}
        onShowBoard={showGrid}
        addLabel="Open another app"
      />

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
 * The Apps grid.
 *
 * The board itself is shared with Developer Tools — see `TileBoard`. What is
 * left here is what makes it the *Apps* board: which things are on it, how
 * they are grouped, and the words above them.
 */
function AppGrid({ onOpen, openIds }: { onOpen: (id: string) => void; openIds: string[] }) {
  return (
    <TileBoard
      items={APPS.map((app) => ({
        ...app,
        // Said on the tile because it is the one thing worth knowing before
        // clicking: will this ask me to sign in?
        badge: app.auth === "none" ? undefined : `needs ${app.auth}`,
      }))}
      label="Apps"
      groups={APP_GROUPS}
      storageKey={APPS_KEY}
      openIds={openIds}
      onOpen={onOpen}
      header={({ shown, groups, hidden }) => (
        <>
          <p className="board__eyebrow">
            <span>{shown} apps</span>
            <span className="board__eyebrow-sep" aria-hidden="true">
              ·
            </span>
            <span>{groups} groups</span>
            {hidden > 0 && (
              <>
                <span className="board__eyebrow-sep" aria-hidden="true">
                  ·
                </span>
                <span>{hidden} hidden</span>
              </>
            )}
          </p>
          <h1 className="board__title">Apps</h1>
          <p className="board__lede">
            Open as many as you like — they stay open in tabs above. Press{" "}
            <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to move between them.
          </p>
        </>
      )}
    />
  );
}
