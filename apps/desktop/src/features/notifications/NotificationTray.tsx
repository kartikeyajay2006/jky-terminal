import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboard } from "../dashboard/dashboardStore";
import { dueNotifications, type DueItem } from "./due";
import { loadDismissed, loadTrayOpen, pruneDismissed, saveDismissed, saveTrayOpen } from "./trayState";
import "./NotificationTray.css";

/** How often to recheck what is due. Alert leads are minutes, not seconds. */
const CHECK_INTERVAL_MS = 30_000;

/**
 * The bell in the corner.
 *
 * Fixed to the window rather than nested in the Dashboard, so it is visible
 * from the Terminal or Assistant tab too — the whole reason for building
 * this rather than leaving alerts as something you only saw if you happened
 * to have the Dashboard open.
 */
export function NotificationTray() {
  const events = useDashboard((s) => s.events);
  const reminders = useDashboard((s) => s.reminders);
  const saveReminder = useDashboard((s) => s.saveReminder);

  const [open, setOpen] = useState(loadTrayOpen);
  const [dismissed, setDismissed] = useState(loadDismissed);
  const [now, setNow] = useState(() => new Date());

  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const due = dueNotifications(events, reminders, now);
  const visible = due.filter((d) => !dismissed.has(d.key));

  // Dismissal keys are only worth keeping while their item might still be
  // due; once a day turns over or an event's window closes, forgetting the
  // key is what keeps this from growing for the life of the install.
  //
  // Depends on the primitive tick and the collections themselves, not `due`
  // — that array is rebuilt fresh every render, including renders this very
  // effect causes by touching `dismissed`, which would otherwise re-run it
  // every time regardless of whether anything due actually changed.
  useEffect(() => {
    const currentKeys = new Set(dueNotifications(events, reminders, now).map((d) => d.key));
    setDismissed((prev) => {
      const pruned = pruneDismissed(prev, currentKeys);
      if (pruned.size !== prev.size) saveDismissed(pruned);
      return pruned;
    });
  }, [events, reminders, now]);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    saveTrayOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

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

  function toggle() {
    const next = !open;
    setOpen(next);
    saveTrayOpen(next);
  }

  function dismiss(key: string) {
    setDismissed((prev) => {
      const next = new Set(prev).add(key);
      saveDismissed(next);
      return next;
    });
  }

  function markReminderDone(item: DueItem) {
    const reminder = reminders.find((r) => r.id === item.id);
    if (reminder) void saveReminder({ ...reminder, done: true });
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
        onClick={toggle}
      >
        <span aria-hidden="true">🔔</span>
        {visible.length > 0 && (
          <span className="tray__badge" aria-hidden="true">
            {visible.length}
          </span>
        )}
      </button>

      {open && (
        <div className="tray__pop" role="dialog" aria-label="Notifications">
          <div className="tray__bar">
            <span className="tray__title">Notifications</span>
            <button
              type="button"
              className="tray__close"
              aria-label="Close notifications"
              onClick={() => close()}
            >
              ×
            </button>
          </div>

          {visible.length === 0 ? (
            <p className="tray__empty">Nothing needs you right now.</p>
          ) : (
            <ul className="tray__list" aria-label="Due now">
              {visible.map((item) => (
                <li key={item.key} className="tray__item">
                  {item.kind === "event" && (
                    <span className="dot" data-colour={item.colour} aria-hidden="true" />
                  )}
                  <span className="tray__text">
                    <span className="tray__item-title">{item.title}</span>
                    <span className="tray__item-detail">{item.detail}</span>
                  </span>
                  {item.kind === "reminder" && (
                    <button
                      type="button"
                      className="tray__done"
                      aria-label={`Mark "${item.title}" done`}
                      onClick={() => markReminderDone(item)}
                    >
                      ✓
                    </button>
                  )}
                  <button
                    type="button"
                    className="tray__dismiss"
                    aria-label={`Dismiss "${item.title}"`}
                    onClick={() => dismiss(item.key)}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
