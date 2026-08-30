import { useEffect, useState, type ReactNode } from "react";
import { AppSwitcher } from "./AppSwitcher";
import { APPS, findApp, type AppDef } from "./registry";
import { Calculator } from "./calculator/Calculator";
import { Timer } from "./timer/Timer";
import { MapApp } from "./map/Map";
import { News } from "./news/News";
import { Weather } from "./weather/Weather";
import { useNav } from "../../app/navStore";
import "./Apps.css";

/** Where the section is: the grid, or one app's id. */
type View = "grid" | string;

const LAST_VIEW_KEY = "jky.apps.last";

function loadLastView(): View {
  try {
    const stored = localStorage.getItem(LAST_VIEW_KEY);
    if (stored && (stored === "grid" || findApp(stored))) return stored;
  } catch {
    // Storage throws in a private window; the grid is a fine default.
  }
  return "grid";
}

/**
 * The body of one app.
 *
 * A switch rather than a component stored on the registry record, because the
 * registry is plain data read by tests and, later, by the Rust side — putting
 * React components in it would make it un-shareable for the sake of saving
 * this function.
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
    default:
      return null;
  }
}

/**
 * The Apps section.
 *
 * Opening an app replaces the grid rather than opening a window: the rule this
 * was built to satisfy is that an app opens *here*, not in the system browser.
 * Moving between apps goes through the switcher, so you never have to climb
 * back out to the grid to get somewhere else.
 *
 * Only the open app is mounted. Apps that fetch would otherwise keep polling
 * in the background, and the timer would keep counting where nobody could see
 * it — the same reason the games unmount when you leave them.
 */
export function Apps() {
  const [view, setView] = useState<View>(loadLastView);
  const [switching, setSwitching] = useState(false);

  const open = view === "grid" ? undefined : findApp(view);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_VIEW_KEY, view);
    } catch {
      // Preference lost, app fine.
    }
  }, [view]);

  // The palette can ask for a named app; the request is left in the store for
  // this section to take, so which app was wanted survives the section switch.
  const pendingNav = useNav((s) => s.pending);
  useEffect(() => {
    const wanted = useNav.getState().takePanel("apps");
    if (!wanted) return;
    if (wanted === "grid" || findApp(wanted)) setView(wanted);
  }, [pendingNav]);

  // Bound here rather than in `useShortcuts` because it means nothing outside
  // this section, and a global binding for it would be one more chord to think
  // about while typing into a terminal.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSwitching((s) => !s);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function choose(id: string) {
    setView(id);
    setSwitching(false);
  }

  if (!open) return <AppGrid onOpen={choose} />;

  return (
    <div
      className="apps apps--open"
      style={{ ["--app-accent" as string]: `var(--${open.accent})` }}
    >
      <header className="apps__bar">
        <button type="button" className="apps__back" onClick={() => setView("grid")}>
          <span aria-hidden="true">←</span> All apps
        </button>
        <h1 className="apps__open-title">
          <span className="apps__open-glyph" aria-hidden="true">
            {open.glyph}
          </span>
          {open.name}
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

      <div className="apps__stage">{appBody(open.id)}</div>

      {switching && (
        <AppSwitcher currentId={open.id} onChoose={choose} onClose={() => setSwitching(false)} />
      )}
    </div>
  );
}

function AppGrid({ onOpen }: { onOpen: (id: string) => void }) {
  return (
    <div className="apps">
      <header className="apps__head">
        <p className="apps__eyebrow">
          {APPS.length} apps · no account needed
        </p>
        <h1 className="apps__title">Apps</h1>
        <p className="apps__lede">
          Each one opens here, in this window. Pick one to start, then press{" "}
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> to move between them.
        </p>
      </header>

      <ul className="apps__grid" aria-label="Apps">
        {APPS.map((app) => (
          <li key={app.id}>
            <Tile app={app} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Tile({ app, onOpen }: { app: AppDef; onOpen: (id: string) => void }) {
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
      {app.auth !== "none" && <span className="apps__tile-auth">needs {app.auth}</span>}
    </button>
  );
}
