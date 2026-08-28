import { useEffect } from "react";
import { useDashboard } from "../dashboard/dashboardStore";
import { dueNotifications } from "./due";
import { NotificationBanners } from "./NotificationBanners";
import { NotificationTray } from "./NotificationTray";
import { useNotifications } from "./notificationStore";
import "./Notifications.css";

/** How often to recheck what is due. Alert leads are minutes, not seconds. */
export const CHECK_INTERVAL_MS = 30_000;

/**
 * Everything the notification system puts on screen.
 *
 * Owns the clock and the due list so the banners and the centre are always
 * looking at the same instant — two components each running their own
 * interval would drift, and a row could sit in the centre saying "in 2 min"
 * while its banner said "in 3".
 */
export function Notifications() {
  const events = useDashboard((s) => s.events);
  const reminders = useDashboard((s) => s.reminders);
  const todos = useDashboard((s) => s.todos);
  const now = useNotifications((s) => s.now);
  const tick = useNotifications((s) => s.tick);
  const prune = useNotifications((s) => s.prune);

  useEffect(() => {
    const id = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tick]);

  const due = dueNotifications(events, reminders, todos, now);

  // Dismissal keys are only worth keeping while their item might still be
  // due; once a day turns over or an event's window closes, forgetting the
  // key is what keeps the set from growing for the life of the install.
  useEffect(() => {
    prune(new Set(dueNotifications(events, reminders, todos, now).map((d) => d.key)));
  }, [events, reminders, todos, now, prune]);

  return (
    <>
      <NotificationBanners due={due} />
      <NotificationTray due={due} />
    </>
  );
}
