import type { Event, EventColour, Reminder, Todo } from "../../platform";
import { localDate } from "../dashboard/eventTime";

export type DueKind = "event" | "reminder" | "todo";

/**
 * One thing the tray is telling you about right now.
 *
 * `key` doubles as the dismissal key: stable for the life of one due window,
 * so dismissing an item does not un-dismiss the instant its minute ticks
 * over, and a reminder gets a fresh key each day it recurs.
 */
export interface DueItem {
  key: string;
  kind: DueKind;
  id: string;
  title: string;
  /** Events carry their own colour; the others take their kind's. */
  colour?: EventColour;
  /** The line under the title: when it is, or how overdue it is. */
  detail: string;
  /**
   * Ordering weight. Lower sorts first, so what is about to happen sits
   * above a todo that has been open for a week.
   */
  weight: number;
  /** Milliseconds since the epoch, for "2m ago" style stamps. */
  since: number;
  /** Loud enough to interrupt with a banner, rather than only to be listed. */
  urgent: boolean;
}

/** The glyph each kind wears, so a row is identifiable before it is read. */
export const KIND_GLYPH: Record<DueKind, string> = {
  event: "◆",
  reminder: "◔",
  todo: "☑",
};

/** The colour token each non-event kind wears. */
export const KIND_COLOUR: Record<DueKind, EventColour> = {
  event: "cyan",
  reminder: "violet",
  todo: "mint",
};

/** Minutes remaining, as words: "starting now", "in 12 min", "in 2 hours". */
function untilWords(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes <= 0) return "starting now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/** How long ago, as words: "just now", "12m ago", "3h ago", "2d ago". */
export function agoWords(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
        // Sorted by how close it is, so the next thing to happen is on top.
        weight: startsMs - nowMs,
        since: opensMs,
        urgent: true,
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
    .map((r) => {
      const [h, m] = r.at.split(":").map(Number);
      const at = new Date(now);
      at.setHours(h, m, 0, 0);
      return {
        key: `reminder:${r.id}:${today}`,
        kind: "reminder" as const,
        id: r.id,
        title: r.text,
        colour: KIND_COLOUR.reminder,
        detail: `due at ${r.at}`,
        // Right after events: today's business, but not to the minute.
        weight: 1_000_000_000 + (now.getTime() - at.getTime()),
        since: at.getTime(),
        urgent: true,
      };
    });
}

/**
 * Every todo still open.
 *
 * A todo carries no time at all, so unlike the other two there is no moment
 * at which it becomes due — it simply is, until it is ticked. That makes it
 * the quiet kind: always listed, never allowed to raise a banner, and sorted
 * below everything that actually has a clock attached to it.
 */
export function dueTodos(todos: Todo[], now: Date): DueItem[] {
  const nowMs = now.getTime();
  return todos
    .filter((t) => !t.done)
    .map((t) => {
      const created = new Date(t.created_at).getTime();
      const age = Number.isNaN(created) ? 0 : nowMs - created;
      return {
        key: `todo:${t.id}`,
        kind: "todo" as const,
        id: t.id,
        title: t.text,
        colour: KIND_COLOUR.todo,
        // The oldest untouched todo is the interesting one, so say its age.
        detail: `open · added ${agoWords(age)}`,
        // Last, and oldest-first within the group.
        weight: 2_000_000_000 - age,
        since: Number.isNaN(created) ? nowMs : created,
        urgent: false,
      };
    });
}

/**
 * Everything the tray should be showing right now, most pressing first.
 *
 * Sorted by weight rather than concatenated in kind order, so an event
 * starting in two minutes outranks a reminder that has been sitting there
 * since seven in the morning.
 */
export function dueNotifications(
  events: Event[],
  reminders: Reminder[],
  todos: Todo[] = [],
  now: Date = new Date(),
): DueItem[] {
  return [
    ...dueEvents(events, now),
    ...dueReminders(reminders, now),
    ...dueTodos(todos, now),
  ].sort((a, b) => a.weight - b.weight);
}
