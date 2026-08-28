import { useCallback, useEffect, useRef } from "react";
import { useDashboard } from "../dashboard/dashboardStore";
import type { DueItem, DueKind } from "./due";
import { NotificationRow } from "./NotificationRow";
import { useNotifications } from "./notificationStore";

/** The order groups appear in, and what each is called. */
const GROUPS: Array<{ kind: DueKind; label: string }> = [
  { kind: "event", label: "Happening soon" },
  { kind: "reminder", label: "Reminders" },
  { kind: "todo", label: "Still open" },
];

/**
 * The bell and the notification centre behind it.
 *
 * Fixed to the window rather than nested in the Dashboard, so it is reachable
 * from the Terminal or Assistant tab too — the whole reason for building this
 * rather than leaving alerts as something you only saw if you happened to
 * have the Dashboard open.
 */
export function NotificationTray({ due }: { due: DueItem[] }) {
  const reminders = useDashboard((s) => s.reminders);
  const todos = useDashboard((s) => s.todos);
  const saveReminder = useDashboard((s) => s.saveReminder);
  const saveTodo = useDashboard((s) => s.saveTodo);

  const open = useNotifications((s) => s.open);
  const setOpen = useNotifications((s) => s.setOpen);
  const dismissed = useNotifications((s) => s.dismissed);
  const now = useNotifications((s) => s.now);
  const dismiss = useNotifications((s) => s.dismiss);
  const dismissMany = useNotifications((s) => s.dismissMany);

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const visible = due.filter((d) => !dismissed.has(d.key));

  const close = useCallback(
    (restoreFocus = true) => {
      setOpen(false);
      if (restoreFocus) triggerRef.current?.focus();
    },
    [setOpen],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, close]);

  /**
   * Ticking a reminder or todo off completes it, rather than merely hiding
   * the row. Dismissing is the other button, and the difference matters: one
   * says "done", the other says "not now".
   */
  function complete(item: DueItem) {
    if (item.kind === "reminder") {
      const r = reminders.find((x) => x.id === item.id);
      if (r) void saveReminder({ ...r, done: true });
    } else if (item.kind === "todo") {
      const t = todos.find((x) => x.id === item.id);
      if (t) void saveTodo({ ...t, done: true });
    }
  }

  return (
    <div className="tray" ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className="tray__bell"
        aria-label="Notifications"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-alert={visible.length > 0 || undefined}
        onClick={() => setOpen(!open)}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path
            d="M12 3a5.5 5.5 0 0 0-5.5 5.5c0 3.2-.8 5-1.6 6.1a1 1 0 0 0 .8 1.6h12.6a1 1 0 0 0 .8-1.6c-.8-1.1-1.6-2.9-1.6-6.1A5.5 5.5 0 0 0 12 3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
          <path
            d="M10 19a2 2 0 0 0 4 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          />
        </svg>
        {visible.length > 0 && (
          <span className="tray__badge" aria-hidden="true">
            {visible.length > 9 ? "9+" : visible.length}
          </span>
        )}
      </button>

      {open && (
        <div className="tray__pop" role="dialog" aria-label="Notifications">
          <div className="tray__bar">
            <span className="tray__title">
              Notifications
              {visible.length > 0 && <span className="tray__count">{visible.length}</span>}
            </span>
            <span className="tray__bar-actions">
              {visible.length > 0 && (
                <button
                  type="button"
                  className="tray__clear"
                  onClick={() => dismissMany(visible.map((v) => v.key))}
                >
                  Clear all
                </button>
              )}
              <button
                type="button"
                className="tray__close"
                aria-label="Close notifications"
                onClick={() => close()}
              >
                ×
              </button>
            </span>
          </div>

          {visible.length === 0 ? (
            <div className="tray__empty">
              <span className="tray__empty-glyph" aria-hidden="true">
                ✓
              </span>
              <p className="tray__empty-title">You are all caught up</p>
              <p className="tray__empty-hint">
                Events, reminders and open todos show up here as they come due.
              </p>
            </div>
          ) : (
            <div className="tray__groups">
              {GROUPS.map(({ kind, label }) => {
                const rows = visible.filter((v) => v.kind === kind);
                if (rows.length === 0) return null;
                return (
                  <section key={kind} className="tray__group">
                    <h3 className="tray__group-head">
                      {label}
                      <span className="tray__group-count">{rows.length}</span>
                    </h3>
                    <ul className="tray__list" aria-label={label}>
                      {rows.map((item) => (
                        <li key={item.key}>
                          <NotificationRow
                            item={item}
                            now={now}
                            onDismiss={() => dismiss(item.key)}
                            onComplete={
                              item.kind === "event" ? undefined : () => complete(item)
                            }
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
