import { useEffect, useRef } from "react";
import { APPS, type AppDef } from "./registry";

interface AppSwitcherProps {
  currentId: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}

/**
 * The overlay that moves between apps without going back to the grid.
 *
 * It lists every app rather than only the others, and marks the one already
 * open. Hiding the current app would make the list jump by one row depending
 * on where you happened to be, so the same app would sit under a different
 * position every time — which is exactly the thing that stops a switcher from
 * becoming muscle memory.
 */
export function AppSwitcher({ currentId, onChoose, onClose }: AppSwitcherProps) {
  const panel = useRef<HTMLDivElement>(null);

  // Focus moves into the overlay so the keyboard is already where the eye is,
  // and so Escape reaches the handler below without a click first.
  useEffect(() => {
    const current = panel.current?.querySelector<HTMLButtonElement>("[aria-current='true']");
    (current ?? panel.current?.querySelector("button"))?.focus();
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="apps__scrim" onMouseDown={onClose}>
      <div
        ref={panel}
        className="apps__switcher"
        role="dialog"
        aria-modal="true"
        aria-label="Switch app"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <p className="apps__switcher-title">Switch app</p>
        <ul className="apps__switcher-list">
          {APPS.map((app) => (
            <li key={app.id}>
              <SwitcherItem app={app} current={app.id === currentId} onChoose={onChoose} />
            </li>
          ))}
        </ul>
        <p className="apps__switcher-hint">
          <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>A</kbd> from anywhere · <kbd>Esc</kbd> to close
        </p>
      </div>
    </div>
  );
}

function SwitcherItem({
  app,
  current,
  onChoose,
}: {
  app: AppDef;
  current: boolean;
  onChoose: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className="apps__switcher-item"
      style={{ ["--app-accent" as string]: `var(--${app.accent})` }}
      // `true` rather than `page`: these are apps within one section, not
      // separate destinations, and "page" would overstate what changed.
      aria-current={current ? "true" : undefined}
      onClick={() => onChoose(app.id)}
    >
      <span className="apps__switcher-glyph" aria-hidden="true">
        {app.glyph}
      </span>
      <span className="apps__switcher-name">{app.name}</span>
      {current && <span className="apps__switcher-open">open</span>}
    </button>
  );
}
