import type { Event, Reminder } from "../../platform";

/**
 * Ordering and formatting for events and reminders.
 *
 * Separate from the widgets that show them because two widgets show the same
 * list — the Upcoming Events panel and the overview card — and they must not
 * disagree about what "upcoming" means.
 */

/** A timestamp we cannot read must not take the dashboard down with it. */
function time(at: string): number {
  const t = new Date(at).getTime();
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

export function isReadable(at: string): boolean {
  return !Number.isNaN(new Date(at).getTime());
}

/**
 * Events that have not happened yet, soonest first.
 *
 * An event starting this minute still counts as upcoming: dropping it the
 * instant the clock ticks past is how someone misses the meeting they are
 * looking at the dashboard to check.
 */
export function upcoming(events: Event[], now: Date = new Date(), limit?: number): Event[] {
  const cutoff = now.getTime();
  const future = events
    .filter((e) => isReadable(e.starts_at) && time(e.starts_at) >= cutoff)
    .sort((a, b) => time(a.starts_at) - time(b.starts_at));
  return limit === undefined ? future : future.slice(0, limit);
}

/** Events already past, most recent first. */
export function past(events: Event[], now: Date = new Date()): Event[] {
  const cutoff = now.getTime();
  return events
    .filter((e) => isReadable(e.starts_at) && time(e.starts_at) < cutoff)
    .sort((a, b) => time(b.starts_at) - time(a.starts_at));
}

/** Every event on one local day, in the order they happen. */
export function eventsOn(events: Event[], day: string): Event[] {
  return events
    .filter((e) => isReadable(e.starts_at) && localDayOf(e.starts_at) === day)
    .sort((a, b) => time(a.starts_at) - time(b.starts_at));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local day an instant falls on. Stored UTC, read on your own clock. */
export function localDayOf(at: string): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `10:00 AM`, on the reader's clock. */
export function clockTime(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "--:--";
  const h = d.getHours();
  const suffix = h < 12 ? "AM" : "PM";
  // 0 and 12 both display as 12, which is the one case a naive modulo gets
  // wrong: midnight would read "00:00 AM".
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad(hour12)}:${pad(d.getMinutes())} ${suffix}`;
}

/** `Aug 26, 2026`. */
export function longDate(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** `07:00` to `07:00 AM`, for a reminder's wall-clock time. */
export function clockFromHhMm(at: string): string {
  const [h, m] = at.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return at;
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${pad(hour12)}:${pad(m)} ${suffix}`;
}

/** Reminders in the order of the day, not the order they were added. */
export function byTimeOfDay(reminders: Reminder[]): Reminder[] {
  return [...reminders].sort((a, b) => a.at.localeCompare(b.at));
}
