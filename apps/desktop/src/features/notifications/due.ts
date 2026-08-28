import type { Event, EventColour, Reminder } from "../../platform";
import { localDate } from "../dashboard/eventTime";

/**
 * One thing the tray is telling you about right now.
 *
 * `key` doubles as the dismissal key: stable for the life of one due window,
 * so dismissing an event does not un-dismiss the instant its minute ticks
 * over, and a reminder gets a fresh key each day it recurs.
 */
export interface DueItem {
  key: string;
  kind: "event" | "reminder";
  id: string;
  title: string;
  colour?: EventColour;
  detail: string;
}

/** Minutes remaining, as words: "starting now", "in 12 min", "in 2 hours". */
function untilWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 0) return "starting now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * Events whose alert window has opened and which have not started yet.
 *
 * The upper bound matters as much as the lower one: without it, a laptop
 * reopened after being closed over a long weekend would declare every
 * meeting that happened while it was shut "due right now".
 */
export function dueEvents(events: Event[], now: Date): DueItem[] {
  const nowMs = now.getTime();
  const out: DueItem[] = [];
  for (const e of events) {
    if (e.alert_minutes_before === null) continue;
    const startsMs = new Date(e.starts_at).getTime();
    if (Number.isNaN(startsMs)) continue;
    const opensMs = startsMs - e.alert_minutes_before * 60_000;
    if (nowMs >= opensMs && nowMs < startsMs) {
      out.push({
        key: `event:${e.id}`,
        kind: "event",
        id: e.id,
        title: e.title,
        colour: e.colour,
        detail: untilWords(startsMs - nowMs),
      });
    }
  }
  return out;
}

/**
 * Reminders whose wall-clock time has passed today and are not done.
 *
 * `at` is a daily time, not a date, so "due" resets with the calendar day —
 * the key below carries today's date for exactly that reason, so dismissing
 * today's occurrence does not silence tomorrow's.
 */
export function dueReminders(reminders: Reminder[], now: Date): DueItem[] {
  const nowHhMm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const today = localDate(now);
  return reminders
    .filter((r) => !r.done && r.at <= nowHhMm)
    .map((r) => ({
      key: `reminder:${r.id}:${today}`,
      kind: "reminder" as const,
      id: r.id,
      title: r.text,
      detail: r.at,
    }));
}

/** Everything the tray should be showing right now, events then reminders. */
export function dueNotifications(
  events: Event[],
  reminders: Reminder[],
  now: Date = new Date(),
): DueItem[] {
  return [...dueEvents(events, now), ...dueReminders(reminders, now)];
}
